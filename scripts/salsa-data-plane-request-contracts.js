'use strict';

/**
 * Source-reviewed top-level request fields for selected WESTO Data Plane
 * mutations.  These are observations from the domain functions that receive
 * the route body; they are not a substitute for a versioned domain schema and
 * intentionally do not declare types, requiredness, enums, or nested rules.
 */

const contracts = new Map();
const noBodyContracts = new Map();
const formDataContracts = new Map();

function add(method, paths, fields, sourceEvidence) {
  for (const path of paths) {
    contracts.set(`${method.toUpperCase()} ${path}`, {
      status: 'source_observed_domain_fields',
      fields: [...new Set(fields)].sort(),
      sourceEvidence
    });
  }
}

function addNoBody(method, paths, sourceEvidence) {
  for (const path of paths) {
    noBodyContracts.set(`${method.toUpperCase()} ${path}`, {
      status: 'source_reviewed_no_body',
      fields: [],
      sourceEvidence
    });
  }
}

function addFormData(method, paths, fields, sourceEvidence) {
  for (const path of paths) {
    formDataContracts.set(`${method.toUpperCase()} ${path}`, {
      status: 'source_reviewed_form_data',
      fields: [...new Set(fields)].sort(),
      contentType: 'multipart/form-data',
      sourceEvidence
    });
  }
}

// Source-reviewed actions below consume only path/query/header/auth context.
// They intentionally produce no JSON requestBody schema in OpenAPI.
addNoBody('POST', ['/v1/pos/sales', '/api/pos/sales', '/v1/pos/sales/:id/refunds', '/api/pos/sales/:id/refunds'], [
  { file: 'server/accounting-routes.js', lines: '101-107,220-224', note: 'Legacy POS writes and refunds are routed to financeV1PosReadOnly, which returns 410 without reading the request body.' }
]);
addNoBody('POST', ['/api/admin/finance/einvoices/:id/retry'], [
  { file: 'server/accounting-routes.js', lines: '301-313', note: 'Tax invoice retry uses path id and scoped invoice state; request body is not consumed.' }
]);
addNoBody('POST', ['/api/admin/finance/journal', '/api/admin/finance/journal/:id/reverse'], [
  { file: 'server/accounting-routes.js', lines: '378-400', note: 'Legacy journal write/reversal compatibility routes return 410 and do not consume request body.' }
]);
addNoBody('POST', ['/api/admin/finance/purchase-orders/:id/approve'], [
  { file: 'server/accounting-routes.js', lines: '715-741', note: 'Purchase-order approval resolves the path id and scoped resource; request body is not consumed.' }
]);
addNoBody('POST', ['/api/admin/finance/depreciation/run'], [
  { file: 'server/accounting-routes.js', lines: '1060-1068', note: 'Depreciation run uses persisted accounting state and does not consume request body.' }
]);
addNoBody('POST', ['/v1/reconciliations/bank', '/api/admin/finance/bank-feed/auto-match', '/api/admin/finance/bank-feed/automatch'], [
  { file: 'server/accounting-routes.js', lines: '1151-1161', note: 'Bank auto-match uses scoped branch context and persisted feed rows; request body is not consumed.' }
]);
addNoBody('POST', ['/api/admin/finance/accruals/:id/reverse'], [
  { file: 'server/accounting-routes.js', lines: '1342-1355', note: 'Accrual reversal uses path id and authenticated actor; request body is not consumed.' }
]);
addNoBody('POST', ['/api/admin/finance/rebuild-ledger'], [
  { file: 'server/accounting-routes.js', lines: '1456-1464', note: 'Ledger rebuild derives from persisted orders and does not consume request body.' }
]);
addNoBody('DELETE', ['/api/admin/v2/staff/:phone', '/api/admin/v2/resources/:resource/:id'], [
  { file: 'server/admin-v2.js', lines: '416-425,570-582', note: 'Admin V2 deletes use path identifiers and do not consume request body.' }
]);
addNoBody('POST', [
  '/api/admin/v2/finance/rollout/:branchId/cutover-request',
  '/api/admin/v2/finance/purchase-orders/:id/submit',
  '/api/admin/v2/finance/cost-commitments/:id/deactivate',
  '/api/admin/v2/finance/events/orders/:orderId/capture',
  '/api/admin/v2/finance/migration/classify',
  '/api/admin/v2/finance/migration/archive/:id/backfill-preview',
  '/api/admin/v2/finance/migration/archive/:id/backfill-request',
  '/api/admin/v2/finance/journal-entries/:id/submit'
], [
  { file: 'server/finance-v2.js', lines: '6299-6753', note: 'Finance V2 actions consume path/query/header idempotency context and domain state; no JSON request body is read.' }
]);
addNoBody('POST', ['/api/staff/shifts/open', '/api/staff/shifts/close'], [
  { file: 'server/server.js', lines: '1578-1610', note: 'Shift open/close derives branch and user from auth/query context; request body is not consumed.' }
]);
addNoBody('POST', ['/api/admin/neem-integration/retry', '/api/admin/neem-integration/backfill'], [
  { file: 'server/server.js', lines: '1754-1762', note: 'NEEM integration retry/backfill uses bridge state only; request body is not consumed.' }
]);
addNoBody('POST', ['/api/auth/logout'], [
  { file: 'server/server.js', lines: '1860-1863', note: 'Logout clears the session cookie and returns success; request body is not consumed.' }
]);
addNoBody('DELETE', ['/api/user/addresses/:id'], [
  { file: 'server/server.js', lines: '2069-2084', note: 'Address deletion uses authenticated user and path id; request body is not consumed.' }
]);
addNoBody('POST', ['/api/user/addresses/:id/default'], [
  { file: 'server/server.js', lines: '2088-2103', note: 'Default-address selection uses authenticated user and path id; request body is not consumed.' }
]);
addNoBody('PUT', ['/api/products/:id'], [
  { file: 'server/server.js', lines: '2276-2280', note: 'Legacy product compatibility route returns 410 without consuming request body.' }
]);
addNoBody('DELETE', [
  '/api/admin/menu-complements/:id',
  '/api/admin/menu-complement-rules/:id',
  '/api/menu/categories/:id',
  '/api/menu/:id',
  '/api/admin/delivery-zones/:id',
  '/api/faq/:id',
  '/api/admin/users/:phone',
  '/api/admin/branches/:id',
  '/api/admin/promotions/:id',
  '/api/admin/promo-slides/:id'
], [
  { file: 'server/server.js', lines: '2400-2436,2631-2650,2745-2750,4252-4265,4872-4878,5102-5115,5737-5760,5801-5806,5843-5848', note: 'Delete handlers use path identifiers and persisted resource state; request body is not consumed.' }
]);
addNoBody('POST', ['/api/promo-slides/:id/impression', '/api/promo-slides/:id/click'], [
  { file: 'server/server.js', lines: '5861-5873', note: 'Impression/click counters use path id only and return 204; request body is not consumed.' }
]);
addNoBody('POST', ['/api/orders/:id/pay-wallet'], [
  { file: 'server/server.js', lines: '6789-6845', note: 'Wallet payment uses path order id, authenticated phone and persisted wallet/order state; request body is not consumed.' }
]);
addNoBody('POST', ['/api/campaigns/claim-birthday'], [
  { file: 'server/server.js', lines: '7088-7112', note: 'Birthday claim uses authenticated user and branch query context; request body is not consumed.' }
]);
addNoBody('POST', ['/api/admin/whatsapp/order/:id'], [
  { file: 'server/server.js', lines: '7581-7595', note: 'WhatsApp order preview uses path order id and persisted notification settings; request body is not consumed.' }
]);

addFormData('POST', ['/api/user/avatar/upload'], ['avatar'], [
  { file: 'server/server.js', lines: '1899-1935', note: 'multer.single(avatar) accepts one image file; MIME allowlist and 4 MiB limit are enforced before persistence.' }
]);
addFormData('POST', ['/api/admin/upload'], ['file'], [
  { file: 'server/server.js', lines: '6006-6029', note: 'multer.single(file) accepts one JPEG/PNG/WebP/GIF image; MIME allowlist and 8 MiB limit are enforced before persistence.' }
]);

add('POST', ['/v1/tax/einvoices', '/api/tax/einvoices'], [
  'branchId', 'branch_id', 'source_id', 'sale_id', 'external_id', 'source_type',
  'document_type', 'reference_tax_uid', 'issue_date', 'customer_national_id',
  'buyer_type', 'total_gross_irr', 'total_discount_irr', 'total_tax_irr',
  'total_payable_irr', 'lines', 'payments'
], [{ file: 'server/finance/taxpayer-adapter.js', lines: '71-207', note: 'resolveInvoiceBranch and enqueueTaxInvoice read these top-level invoice fields.' }]);

add('POST', ['/api/admin/finance/vendors'], [
  'id', 'name', 'nameFa', 'phone', 'contactPerson', 'category', 'termsDays',
  'branchId', 'itemIds', 'isSpot', 'notes', 'active'
], [{ file: 'server/accounting-routes.js', lines: '803-870', note: 'handleVendorUpsert destructures the bounded vendor input.' }]);
add('PUT', ['/api/admin/finance/vendors/:id'], [
  'id', 'name', 'nameFa', 'phone', 'contactPerson', 'category', 'termsDays',
  'branchId', 'itemIds', 'isSpot', 'notes', 'active'
], [{ file: 'server/accounting-routes.js', lines: '803-871', note: 'handleVendorUpsert destructures the bounded vendor input.' }]);

add('POST', ['/api/admin/finance/bills/:id/pay', '/api/admin/finance/bills/:id/payments'], [
  'branchId', 'amount', 'amountIrr', 'currency', 'amountUnit', 'paymentMethod',
  'date', 'paymentDate', 'reference', 'createdById'
], [{ file: 'server/finance/procurement-engine.js', lines: '1003-1058', note: 'payVendorBill reads these paymentInput fields.' }]);

add('POST', ['/v1/payroll/runs/:id/disburse', '/api/admin/finance/payroll/runs/:id/disburse'], [
  'amount', 'idempotencyKey', 'bankAccountCode', 'date', 'createdById'
], [{ file: 'server/finance/payroll-engine.js', lines: '18-30,381-463', note: 'disbursePayroll and its fingerprint read these input fields.' }]);

add('POST', ['/api/admin/finance/fixed-assets/:id/dispose'], [
  'salePrice', 'date', 'reason', 'idempotencyKey'
], [{ file: 'server/finance/asset-engine.js', lines: '246-300', note: 'disposeAsset destructures the bounded disposal input.' }]);

add('POST', ['/api/admin/finance/inter-branch-transfer'], [
  'fromBranchId', 'toBranchId', 'amount', 'description', 'date'
], [{ file: 'server/finance/consolidation-engine.js', lines: '62-94', note: 'recordInterBranchTransfer destructures the transfer input.' }]);

add('POST', ['/api/admin/finance/recipes/what-if'], [
  'costAdjustments', 'priceAdjustments'
], [{ file: 'server/finance/fnb-cost-optimizer.js', lines: '277-321', note: 'simulateMenuPricingWhatIf reads the two scenario maps.' }]);

add('POST', ['/api/admin/v2/finance/goods-receipts', '/api/kitchen/inventory/goods-receipts'], [
  'purchaseOrderId', 'poId', 'branchId', 'deliveryNoteNumber', 'lines', 'receivedAt', 'receivedDate', 'notes'
], [{ file: 'server/finance-v2.js', lines: '1903-1980,6245-6270', note: 'receiveGoodsV2Atomic reads these receipt fields.' }]);

add('POST', ['/api/admin/v2/finance/vendor-invoices'], [
  'goodsReceiptId', 'grnId', 'invoiceNumber', 'lines', 'vatIrr', 'totalIrr', 'invoiceDate', 'date', 'dueDate'
], [{ file: 'server/finance-v2.js', lines: '2004-2098,6393-6400', note: 'createVendorInvoiceV2Atomic reads these invoice fields.' }]);

add('POST', ['/api/admin/v2/finance/vendor-invoices/:id/match-review'], [
  'reason', 'comment', 'evidenceReference'
], [{ file: 'server/finance-v2.js', lines: '2105-2130,6402-6415', note: 'requestVendorInvoiceMatchReviewAtomic reads reason/comment and evidence.' }]);

add('POST', ['/api/admin/v2/finance/vendor-invoices/:id/payment-request'], [
  'branchId', 'amountIrr', 'paymentMethod', 'paymentDate', 'date', 'reference'
], [{ file: 'server/finance-v2.js', lines: '2134-2170,6417-6425', note: 'requestSupplierPaymentV2Atomic reads these supplier payment fields.' }]);

add('POST', ['/api/admin/v2/finance/cost-commitments/:id/accruals'], [
  'postingDate', 'amountIrr', 'overrideReason'
], [{ file: 'server/finance-v2.js', lines: '2238-2290,6444-6452', note: 'createCostAccrualAtomic reads these accrual fields.' }]);

add('POST', ['/api/admin/v2/finance/cost-accruals/:id/payment-request'], [
  'amountIrr', 'paymentMethod', 'paymentDate', 'reference', 'note'
], [{ file: 'server/finance-v2.js', lines: '2298-2330,6453-6461', note: 'requestCostAccrualPaymentAtomic reads these payment fields.' }]);

add('POST', ['/api/admin/v2/finance/planning/break-even/preview'], [
  'fixedCostsIrr', 'sales', 'realizedNetSalesIrr', 'remainingOpenDays'
], [{ file: 'server/finance/restaurant-intelligence.js', lines: '342-367,6527-6529', note: 'calculateBreakEven reads these planning inputs.' }]);

add('POST', ['/api/admin/v2/finance/payroll-runs/:id/payment-request'], [
  'liabilityType', 'amountIrr', 'paymentMethod', 'paymentDate', 'reference', 'note'
], [{ file: 'server/finance-v2.js', lines: '2568-2610,6581-6589', note: 'requestPayrollPaymentV2Atomic reads these payment fields.' }]);

add('POST', ['/api/admin/v2/finance/events/cogs/retry-ready'], [
  'branchId', 'confirmed'
], [{ file: 'server/finance-v2.js', lines: '1536-1548,6653-6674', note: 'retryReadyOrderCogs and the route guard read branchId and confirmed.' }]);

add('POST', ['/api/admin/v2/finance/events/:id/resolve'], [
  'counterpartAccount', 'tenders', 'evidenceReference'
], [{ file: 'server/finance-v2.js', lines: '2683-2740,6677-6680', note: 'resolveEventAtomic reads the source-specific resolution fields.' }]);

add('PUT', ['/api/cashier/printer'], [
  'id', 'name', 'model', 'branchId', 'transport', 'systemPrinterName', 'host', 'port',
  'enabled', 'paperWidth', 'charsPerLine', 'renderMode', 'encoding', 'codePage', 'cut', 'timeoutMs'
], [{ file: 'server/network-printer.js', lines: '97-148', note: 'normalizePrinterConfig reads the bounded printer configuration.' }]);

add('POST', ['/api/debug-log'], [
  'sessionId', 'runId', 'hypothesisId', 'location', 'message', 'data', 'timestamp'
], [{ file: 'server/server.js', lines: '5924-5940', note: 'development-only debug ingestion reads these payload fields.' }]);

add('POST', ['/api/orders'], [
  'tableNo', 'fulfillment', 'phone', 'name', 'paymentMethod', 'items',
  'branchId', 'branch', 'deliveryZoneId', 'zoneId', 'deliveryAddress', 'address',
  'deliveryInstructions', 'instructions', 'redeemPoints', 'pointsToRedeem', 'checkNo', 'note'
], [{ file: 'server/server.js', lines: '2975-3138,3422-3429', note: 'createCheckoutOrder consumes these top-level request fields before persisting the public table order; nested item rules remain outside this catalog.' }]);

add('PATCH', ['/api/admin/finance/settings'], [
  'vatRatePct', 'autoPostOrders', 'defaultCashAccount', 'defaultPosAccount',
  'defaultOnlineAccount', 'defaultWalletAccount', 'defaultCreditAccount',
  'defaultVatAccount', 'defaultSalesAccount', 'defaultCogsAccount',
  'defaultInventoryAccount', 'defaultBankAccountId', 'currency'
], [{ file: 'server/accounting-engine.js', lines: '170-224', note: 'updateAccountingSettings applies the explicit allowlist and validation for these accounting setting keys; unknown dynamic keys are rejected.' }]);

function getDataPlaneRequestContract(method, routePath) {
  return contracts.get(`${String(method).toUpperCase()} ${routePath}`) || null;
}

function getDataPlaneNoBodyContract(method, routePath) {
  return noBodyContracts.get(`${String(method).toUpperCase()} ${routePath}`) || null;
}

function getDataPlaneFormDataContract(method, routePath) {
  return formDataContracts.get(`${String(method).toUpperCase()} ${routePath}`) || null;
}

function listDataPlaneRequestContracts() {
  return Object.fromEntries([...contracts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

module.exports = { getDataPlaneRequestContract, getDataPlaneNoBodyContract, getDataPlaneFormDataContract, listDataPlaneRequestContracts };
