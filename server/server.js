/* Westo server: static site + OTP auth + admin/content API (JSON file storage). */
if (!process.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV && !process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV) {
  process.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV = 'true';
  process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV = 'true';
}
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const QRCode = require('qrcode');
const { translateMenuItem, isBrokenEn } = require('./translate');
const {
  ROLE_CAPABILITIES,
  normalizeRole,
  capabilitiesFor,
  branchScopeForUser,
  can: hasCapability,
  roleLabel,
  normalizeFulfillment,
  FULFILLMENTS,
  paymentStatusFor,
  initialOrderStatus,
  hasAcceptedDelivery,
  nextOrderStatusAfterPayment,
  nextOrderStatusAfterDeliveryAcceptance,
  canTransitionOrder,
  canEditOrderBeforeKitchen,
  canSettleOrder,
  allowedOrderTransitions,
  quoteFulfillment,
  nextId,
  createAuditEntry,
  createEventHub,
  isOwnerActor,
  assertStaffMutationBoundary,
} = require('./command-center');
const { createPostgresStateStore } = require('./postgres-state');
const { createCheckoutQuoteToken, verifyCheckoutQuoteToken } = require('./checkout-quote');
const { publicCheckoutOrderView } = require('./public-checkout-order');
const { customerOrderProgress } = require('./customer-order-progress');
const { paymentProviderPublicStatus } = require('./payment-provider-status');
const { createSessionToken, readSessionToken, sessionTokenMatchesTenant } = require('./session-token');
const { normalizeSettlementReference, settlementReferenceIdentity } = require('./settlement-reference');
const { resolveSettlementAmounts } = require('./settlement-amounts');
const { menuItemBelongsToBranch } = require('./menu-branch-scope');
const {
  menuAvailabilityOverride,
  menuItemAvailableForBranch,
  setMenuAvailabilityOverride,
} = require('./menu-availability');
const { createSettlementInFlightKey } = require('./settlement-in-flight-key');
const { resolveAuditTenantId } = require('./audit-tenant-scope');
const { paymentAttemptTransition, orderPaymentStatusForAttempt } = require('./payment-attempt-transitions');
const { isOtpDemoMode } = require('./otp-policy');
const {
  highestAssignedSeat,
  validateCoversForItems,
  validateOrderLineInput,
  validateWaiterOrderAdd,
  validateWaiterKitchenSend,
  validateWaiterCourseFire,
  validateWaiterSettlementTiming,
  validateWaiterOrderEdit,
  validateDeliveryAcceptance,
  isKitchenOrderPaymentEligible,
} = require('./waiter-order-invariants');
const { retainOperationalOrders, mergeActionableOrders } = require('./operational-order-retention');
const { normalizeOrderHistoryCursor, historyPageSize, paginateCachedClosedOrders } = require('./order-history');
const { orderCancellationGuard, receivedAmount, shouldReleaseOrderInventory } = require('./order-cancellation-guard');
const { orderSplitLifecycleGuard } = require('./order-split-policy');
const { prepareKitchenQueue } = require('./kitchen-queue');
const { getOrderAging } = require('./operational-order-aging');
const { translationEngine } = require('./salsa/provider-policy');
const {
  registerAdminV2Routes,
  adminOrderDto,
  operationalOrderDto,
  adminPaymentDto,
} = require('./admin-v2');
const financeV2 = require('./finance-v2');
const {
  effectiveModifierGroupsForItem,
  validateModifierGroupDefinitions,
  calculateModifierLinePrice,
} = require('./menu-modifiers');
const accountingEngine = require('./accounting-engine');
const { buildCheckoutTaxSnapshot } = require('./checkout-tax');
const { registerAccountingRoutes } = require('./accounting-routes');
const loyaltyEngine = require('./finance/loyalty-engine');
const loyaltyAchievements = require('./finance/loyalty-achievements');
const walletEngine = require('./finance/wallet-engine');
const campaignsEngine = require('./finance/campaigns-engine');
const smsEngine = require('./finance/sms-engine');
const shamsi = require('./finance/shamsi.js');
const {
  notifyOrderWhatsApp,
  notifyReservationWhatsApp,
  waMeUrl,
  buildOrderMessage,
  resolveNotifyPhone,
  toWaDigits,
} = require('./whatsapp-notify');
const { createSalsaBridge, createNeemBridge } = require('./salsa-bridge');
const {
  DEFAULT_PRINTER_CONFIG,
  ensurePrintingData,
  listSystemPrinters,
  normalizePrinterConfig,
  printerForBranch,
  printOrder: sendOrderToPrinter,
  printRasterReceipt,
  publicPrinterConfig,
  testPrinter,
} = require('./network-printer');
const waitlist = require('./waitlist');
const {
  loadTenantConfig,
  tenantHostMiddleware,
  publicTenantContext,
  normalizeTenantId,
} = require('./salsa/tenant-config');
const { TenantRegistry } = require('./salsa/tenant-registry');
const { legacyTenantPersistenceError } = require('./salsa/tenant-persistence-policy');
const {
  hasControlPlaneBridgeCredential,
  isTrustedLocalControlPlaneOrigin,
} = require('./control-plane-bridge-auth');
const { createSettlementPersistenceGate } = require('./settlement-persistence-gate');
const { runtimeReadiness } = require('./runtime-readiness');
const {
  CANONICAL_FEATURES,
  resolveFeatureForRoute,
  isFeatureEnabledForTenant,
  getFeatureInfo,
} = require('./salsa/canonical-features');
const {
  createSalsaPrincipalMiddleware,
  createNeemPrincipalMiddleware,
  requireCapabilityEnforced,
  requireAnyCapabilityEnforced,
  salsaRouteAwarePolicyMiddleware,
  neemRouteAwarePolicyMiddleware,
  isOwnerOnlySettingsCategory,
  assertTenantBoundary,
} = require('./salsa/westo-policy-enforcement');
const { lookupCapability, lookupPolicyCapability } = require('./salsa/route-capability-map');
const {
  tenantStorage,
  createTenantContext,
} = require('./salsa/tenant-context');
const { TenantResolver } = require('./salsa/tenant-resolver');
const {
  ControlDataAccess,
  TenantConnectionManager,
} = require('./salsa/data-access');
const { tenantMenuRepository } = require('./salsa/tenant-menu-repository');
const moduleRuntime = require('../modules/runtime');
const { customerAccessSnapshot, withoutUnsubscribedFinance } = require('../modules/platform_core/server/module-access');

// Lazy getters preserve the original closures and tenant-scoped Proxy.
const moduleRouteContext = {
  get ACTIVE_RES_STATUSES() { return ACTIVE_RES_STATUSES; },
  get ALLERGENS() { return ALLERGENS; },
  get DAYPARTS() { return DAYPARTS; },
  get DEFAULT_PRINTER_CONFIG() { return DEFAULT_PRINTER_CONFIG; },
  get FINANCIAL_PAID_ORDER_STATUSES() { return FINANCIAL_PAID_ORDER_STATUSES; },
  get IS_NODE_TEST_RUNTIME() { return IS_NODE_TEST_RUNTIME; },
  get KDS_STATIONS() { return KDS_STATIONS; },
  get MAX_OTP_ATTEMPTS() { return MAX_OTP_ATTEMPTS; },
  get ORDER_IDEMPOTENCY_KEY_RE() { return ORDER_IDEMPOTENCY_KEY_RE; },
  get OTP_COOLDOWN_MS() { return OTP_COOLDOWN_MS; },
  get PAGES() { return PAGES; },
  get PHONE_RE() { return PHONE_RE; },
  get PLATFORM_ONLY_PHONE_IDENTITIES() { return PLATFORM_ONLY_PHONE_IDENTITIES; },
  get QRCode() { return QRCode; },
  get ROLE_CAPABILITIES() { return ROLE_CAPABILITIES; },
  get ROOT() { return ROOT; },
  get SALSA_OPERATION_VIEWS() { return SALSA_OPERATION_VIEWS; },
  get SECRET() { return SECRET; },
  get SESSION_TTL_MS() { return SESSION_TTL_MS; },
  get STAFF_BRANCH_ROLES() { return STAFF_BRANCH_ROLES; },
  get STAFF_WORKSPACES() { return STAFF_WORKSPACES; },
  get TENANT_CONFIG() { return TENANT_CONFIG; },
  get UPLOADS() { return UPLOADS; },
  get USER_ROLE_MAP() { return USER_ROLE_MAP; },
  get activeCashSession() { return activeCashSession; },
  get activeDineInOrderOnTable() { return activeDineInOrderOnTable; },
  get activeStaffShift() { return activeStaffShift; },
  get adjustOrderInventory() { return adjustOrderInventory; },
  get adminOrderDto() { return adminOrderDto; },
  get allocateOrderSplitDiscount() { return allocateOrderSplitDiscount; },
  get allowedOrderTransitions() { return allowedOrderTransitions; },
  get app() { return app; },
  get appendAuditAfterCommit() { return appendAuditAfterCommit; },
  get appendOrderStatus() { return appendOrderStatus; },
  get applyWalletTopupWithFinance() { return applyWalletTopupWithFinance; },
  get assertRequestBranchAccess() { return assertRequestBranchAccess; },
  get assertStaffMutationBoundary() { return assertStaffMutationBoundary; },
  get assertUserBranchAccess() { return assertUserBranchAccess; },
  get assertVisibleCategoryCover() { return assertVisibleCategoryCover; },
  get awardLoyaltyPoints() { return awardLoyaltyPoints; },
  get branchScopeForUser() { return branchScopeForUser; },
  get branchScoped() { return branchScoped; },
  get buildOrderMessage() { return buildOrderMessage; },
  get calculateCheckoutPricing() { return calculateCheckoutPricing; },
  get campaignWalletTopupWithFinance() { return campaignWalletTopupWithFinance; },
  get campaignsEngine() { return campaignsEngine; },
  get canOpenWorkspace() { return canOpenWorkspace; },
  get canTransitionOrder() { return canTransitionOrder; },
  get canonicalTableNo() { return canonicalTableNo; },
  get cashDrawerMovementFingerprint() { return cashDrawerMovementFingerprint; },
  get cashDrawerMutationQueueKey() { return cashDrawerMutationQueueKey; },
  get cashDrawerOpenRetry() { return cashDrawerOpenRetry; },
  get cashDrawerPayOutExceedsAvailable() { return cashDrawerPayOutExceedsAvailable; },
  get cashSessionTotals() { return cashSessionTotals; },
  get checkoutIdempotencyFingerprint() { return checkoutIdempotencyFingerprint; },
  get checkoutQuoteIntent() { return checkoutQuoteIntent; },
  get checkoutReceiptIndexKey() { return checkoutReceiptIndexKey; },
  get checkoutTaxForOrder() { return checkoutTaxForOrder; },
  get cleanDeliveryZone() { return cleanDeliveryZone; },
  get commandCenterPayload() { return commandCenterPayload; },
  get createAndPersistCheckoutOrder() { return createAndPersistCheckoutOrder; },
  get createCheckoutQuoteToken() { return createCheckoutQuoteToken; },
  get crypto() { return crypto; },
  get currentUser() { return currentUser; },
  get customerAccessSnapshot() { return customerAccessSnapshot; },
  get customerOrderStatusProjection() { return customerOrderStatusProjection; },
  get customerOwnsHistoryOrder() { return customerOwnsHistoryOrder; },
  get db() { return db; },
  get defaultBranch() { return defaultBranch; },
  get defaultHoursTemplate() { return defaultHoursTemplate; },
  get effectiveRole() { return effectiveRole; },
  get ensureKdsState() { return ensureKdsState; },
  get ensurePrintingData() { return ensurePrintingData; },
  get eventHub() { return eventHub; },
  get feedbackNpsStats() { return feedbackNpsStats; },
  get financeV2() { return financeV2; },
  get findCashDrawerMovementRetry() { return findCashDrawerMovementRetry; },
  get findOrderBranch() { return findOrderBranch; },
  get fs() { return fs; },
  get generateShortTrackingCode() { return generateShortTrackingCode; },
  get guardPublicCheckoutRecovery() { return guardPublicCheckoutRecovery; },
  get handleEditOrder() { return handleEditOrder; },
  get handleIntegrationBackfill() { return handleIntegrationBackfill; },
  get handleIntegrationRetry() { return handleIntegrationRetry; },
  get handleIntegrationStatus() { return handleIntegrationStatus; },
  get handleSettleOrder() { return handleSettleOrder; },
  get hasAcceptedDelivery() { return hasAcceptedDelivery; },
  get historyPageSize() { return historyPageSize; },
  get isBirthdateLocked() { return isBirthdateLocked; },
  get isBrokenEn() { return isBrokenEn; },
  get isKdsPaymentEligible() { return isKdsPaymentEligible; },
  get isKitchenOrderPaymentEligible() { return isKitchenOrderPaymentEligible; },
  get isOtpDemoMode() { return isOtpDemoMode; },
  get isOwnerActor() { return isOwnerActor; },
  get isSettlementRequestFingerprint() { return isSettlementRequestFingerprint; },
  get kdsIdempotent() { return kdsIdempotent; },
  get kdsLineKey() { return kdsLineKey; },
  get kdsMenuAvailabilityPayload() { return kdsMenuAvailabilityPayload; },
  get kdsPerformance() { return kdsPerformance; },
  get kitchenHeldCourseItems() { return kitchenHeldCourseItems; },
  get kitchenLines() { return kitchenLines; },
  get kitchenTicket() { return kitchenTicket; },
  get listReservationSlots() { return listReservationSlots; },
  get listSystemPrinters() { return listSystemPrinters; },
  get loyaltyAchievements() { return loyaltyAchievements; },
  get loyaltyEngine() { return loyaltyEngine; },
  get makeToken() { return makeToken; },
  get maybeAwardOrderLoyalty() { return maybeAwardOrderLoyalty; },
  get menuItemBelongsToBranch() { return menuItemBelongsToBranch; },
  get menuItemForResponse() { return menuItemForResponse; },
  get moduleRuntime() { return moduleRuntime; },
  get neemBridge() { return neemBridge; },
  get nextDineInCheckNo() { return nextDineInCheckNo; },
  get nextId() { return nextId; },
  get nextOrderStatusAfterDeliveryAcceptance() { return nextOrderStatusAfterDeliveryAcceptance; },
  get nextOrderStatusAfterPayment() { return nextOrderStatusAfterPayment; },
  get normalizeAllergens() { return normalizeAllergens; },
  get normalizeCashDrawerIdempotencyKey() { return normalizeCashDrawerIdempotencyKey; },
  get normalizeCheckoutReceiptCode() { return normalizeCheckoutReceiptCode; },
  get normalizeComplementInput() { return normalizeComplementInput; },
  get normalizeComplementRuleInput() { return normalizeComplementRuleInput; },
  get normalizeDayparts() { return normalizeDayparts; },
  get normalizeDigits() { return normalizeDigits; },
  get normalizeFulfillment() { return normalizeFulfillment; },
  get normalizeOrderHistoryCursor() { return normalizeOrderHistoryCursor; },
  get normalizePrinterConfig() { return normalizePrinterConfig; },
  get normalizeReservationDate() { return normalizeReservationDate; },
  get notifyReservationWhatsApp() { return notifyReservationWhatsApp; },
  get operationalOrderResponse() { return operationalOrderResponse; },
  get operationalPaymentResponse() { return operationalPaymentResponse; },
  get orderCancellationGuard() { return orderCancellationGuard; },
  get orderLinesFromRequest() { return orderLinesFromRequest; },
  get orderSplitLifecycleGuard() { return orderSplitLifecycleGuard; },
  get otpRequestTimestamps() { return otpRequestTimestamps; },
  get otps() { return otps; },
  get paginateCachedClosedOrders() { return paginateCachedClosedOrders; },
  get parseBranchId() { return parseBranchId; },
  get parseCashDrawerAmount() { return parseCashDrawerAmount; },
  get path() { return path; },
  get paymentProviderPublicStatus() { return paymentProviderPublicStatus; },
  get paymentStatusFor() { return paymentStatusFor; },
  get persistAdminConfigMutation() { return persistAdminConfigMutation; },
  get persistFinanceMutation() { return persistFinanceMutation; },
  get persistedOrderBranchId() { return persistedOrderBranchId; },
  get phonesMatch() { return phonesMatch; },
  get prepareKitchenQueue() { return prepareKitchenQueue; },
  get printRasterReceipt() { return printRasterReceipt; },
  get printerForBranch() { return printerForBranch; },
  get productionPaymentProviderReady() { return productionPaymentProviderReady; },
  get publicCheckoutOrderView() { return publicCheckoutOrderView; },
  get publicContentPayload() { return publicContentPayload; },
  get publicGuestMenuPayload() { return publicGuestMenuPayload; },
  get publicOrderMutationGuard() { return publicOrderMutationGuard; },
  get publicPaymentAttempt() { return publicPaymentAttempt; },
  get publicPrinterConfig() { return publicPrinterConfig; },
  get publicRestaurantPayload() { return publicRestaurantPayload; },
  get publicTenantContext() { return publicTenantContext; },
  get publicUser() { return publicUser; },
  get publicWaitlistEntry() { return publicWaitlistEntry; },
  get publishOperationalEvent() { return publishOperationalEvent; },
  get publishPaymentCommitEffects() { return publishPaymentCommitEffects; },
  get quoteFulfillment() { return quoteFulfillment; },
  get receivedAmount() { return receivedAmount; },
  get recordAudit() { return recordAudit; },
  get requestBranchValue() { return requestBranchValue; },
  get requestedBranchAssignments() { return requestedBranchAssignments; },
  get requestedKdsBranch() { return requestedKdsBranch; },
  get requireAdmin() { return requireAdmin; },
  get requireAuth() { return requireAuth; },
  get requireCapability() { return requireCapability; },
  get requireCommandCenterAccess() { return requireCommandCenterAccess; },
  get requireKitchen() { return requireKitchen; },
  get requireOwner() { return requireOwner; },
  get reservationDateWithinWindow() { return reservationDateWithinWindow; },
  get reservationFingerprint() { return reservationFingerprint; },
  get reservationResponse() { return reservationResponse; },
  get resolveBranch() { return resolveBranch; },
  get resolveBranchExact() { return resolveBranchExact; },
  get resolveNotifyPhone() { return resolveNotifyPhone; },
  get resolveSettlementAmounts() { return resolveSettlementAmounts; },
  get respondAdminConfigPersistenceFailure() { return respondAdminConfigPersistenceFailure; },
  get restoreFinanceMutationState() { return restoreFinanceMutationState; },
  get reverseCancelledOrderFinancialEffects() { return reverseCancelledOrderFinancialEffects; },
  get rollbackAuditEntry() { return rollbackAuditEntry; },
  get sandboxPaymentGuard() { return sandboxPaymentGuard; },
  get sanitizeCoverImg() { return sanitizeCoverImg; },
  get sanitizeMenuImg() { return sanitizeMenuImg; },
  get sanitizePromoSlideInput() { return sanitizePromoSlideInput; },
  get save() { return save; },
  get sendOrderToPrinter() { return sendOrderToPrinter; },
  get serializeAdminConfigMutation() { return serializeAdminConfigMutation; },
  get serializeBranchOrderMutation() { return serializeBranchOrderMutation; },
  get serializeOrderMutationRoute() { return serializeOrderMutationRoute; },
  get serializePaymentOrderMutationRoute() { return serializePaymentOrderMutationRoute; },
  get serializeReservationCreation() { return serializeReservationCreation; },
  get serializeWaitlistMutation() { return serializeWaitlistMutation; },
  get setMenuAvailabilityOverride() { return setMenuAvailabilityOverride; },
  get settlePaymentAttempt() { return settlePaymentAttempt; },
  get settlementInFlight() { return settlementInFlight; },
  get settlementLockKey() { return settlementLockKey; },
  get settlementPersistenceGate() { return settlementPersistenceGate; },
  get shamsi() { return shamsi; },
  get shouldReleaseOrderInventory() { return shouldReleaseOrderInventory; },
  get smsEngine() { return smsEngine; },
  get snapshotFinanceMutationState() { return snapshotFinanceMutationState; },
  get staffMenuPayload() { return staffMenuPayload; },
  get stateStore() { return stateStore; },
  get summarizeKdsPaymentReview() { return summarizeKdsPaymentReview; },
  get syncLegacyHours() { return syncLegacyHours; },
  get tableBranchId() { return tableBranchId; },
  get tableForBranch() { return tableForBranch; },
  get tableNoBelongsToTable() { return tableNoBelongsToTable; },
  get tenantConnectionManager() { return tenantConnectionManager; },
  get tenantMenuRepository() { return tenantMenuRepository; },
  get tenantStorage() { return tenantStorage; },
  get testPrinter() { return testPrinter; },
  get toWaDigits() { return toWaDigits; },
  get translateMenuItem() { return translateMenuItem; },
  get translationEngine() { return translationEngine; },
  get upload() { return upload; },
  get userAvatarUpload() { return userAvatarUpload; },
  get userCan() { return userCan; },
  get validateAdminHoursTime() { return validateAdminHoursTime; },
  get validateDeliveryAcceptance() { return validateDeliveryAcceptance; },
  get validateExplicitCheckoutSelections() { return validateExplicitCheckoutSelections; },
  get validateModifierGroupDefinitions() { return validateModifierGroupDefinitions; },
  get validateStaffBranchAssignments() { return validateStaffBranchAssignments; },
  get validateWaiterCourseFire() { return validateWaiterCourseFire; },
  get waMeUrl() { return waMeUrl; },
  get waitlist() { return waitlist; },
  get waitlistForBranch() { return waitlistForBranch; },
  get walletEngine() { return walletEngine; },
  get withCashDrawerMutationLock() { return withCashDrawerMutationLock; },
  get withCashDrawerSettlementLock() { return withCashDrawerSettlementLock; },
};

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
// These legacy platform operator identities must authenticate through the
// platform control plane, never as restaurant owners in a tenant session.
const PLATFORM_ONLY_PHONE_IDENTITIES = new Set(['09120000000']); // [DEV] removed 09374333028

function isPlatformOnlyIdentity(userOrPhone) {
  const phone = typeof userOrPhone === 'string' || typeof userOrPhone === 'number'
    ? String(userOrPhone)
    : String(userOrPhone?.phone || '');
  const normalizedPhone = normalizeDigits(phone).trim();
  return Boolean(userOrPhone?.principalType === 'platform_admin'
    || PLATFORM_ONLY_PHONE_IDENTITIES.has(normalizedPhone));
}
const DEFAULT_JSON_DB_PATH = path.join(__dirname, 'data', 'db.json');
// Capture test-runtime identity once. Individual tests intentionally toggle
// NODE_ENV to exercise production fail-closed branches; persistence guards
// must not follow that mutable value and accidentally write the operator's
// default checkout database from a test timer or shutdown hook.
const IS_NODE_TEST_RUNTIME = process.env.NODE_ENV === 'test'
  || process.execArgv.includes('--test')
  || process.argv.includes('--test')
  || process.argv.some((arg) => /test/i.test(arg));
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = process.env.PORT == null ? 4180 : Number(process.env.PORT);
const FINANCIAL_PAID_ORDER_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
// The restaurant stations need to reach the local server from other devices
// on the same LAN (waiter/KDS/cashier terminals). Keep HOST overridable for
// tests and restricted deployments, but make the normal local run LAN-ready.
const HOST = process.env.HOST || '0.0.0.0';
const SECRET_PATH = process.env.WESTO_SECRET_PATH || path.join(__dirname, 'data', 'secret.key');
const TENANT_CONFIG = loadTenantConfig();

/** Legacy Ciao energy-drink textures — never use as food hero covers. */
function isDrinkTexturePath(raw) {
  const s = String(raw || '');
  return /assets\/textures\/westo_texture_/i.test(s);
}

function sanitizeMenuImg(raw) {
  const img = String(raw || '').trim().slice(0, 300);
  if (!img) return '';
  if (/^(assets\/|uploads\/|https?:\/\/)/.test(img)) return img;
  return null;
}

/** Cover paths: same allowlist as dish img, but drink-label textures are rejected. */
function sanitizeCoverImg(raw) {
  const img = sanitizeMenuImg(raw);
  if (img === null) return null;
  if (!img) return '';
  if (isDrinkTexturePath(img)) return null;
  return img;
}

const PROMO_ACTION_TYPES = new Set(['none', 'url', 'instagram', 'internal', 'category', 'dish']);
const PROMO_KINDS = new Set(['general', 'instagram', 'chef-special', 'event', 'offer', 'announcement']);
const PROMO_PLACEMENTS = new Set(['entrance', 'menu', 'both']);

function promoText(raw, max = 160) {
  return String(raw || '').trim().slice(0, max);
}

function promoIso(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function sanitizePromoSlideInput(input = {}, current = {}) {
  const imageRaw = input.image !== undefined ? sanitizeMenuImg(input.image) : current.image;
  const actionTypeRaw = promoText(input.actionType !== undefined ? input.actionType : current.actionType, 32);
  const kindRaw = promoText(input.kind !== undefined ? input.kind : current.kind, 32);
  const placementRaw = promoText(input.placement !== undefined ? input.placement : current.placement, 24);
  const branchRaw = input.branchId !== undefined ? input.branchId : current.branchId;
  const branchNum = branchRaw == null || branchRaw === '' ? null : Number(normalizeDigits(String(branchRaw)).replace(/\D/g, ''));
  const branchId = Number.isFinite(branchNum) ? branchNum : null;
  const rawAutoplay = input.autoplayMs !== undefined ? input.autoplayMs : current.autoplayMs;
  const parsedAutoplay = typeof rawAutoplay === 'number'
    ? rawAutoplay
    : Number(normalizeDigits(String(rawAutoplay || '')).replace(/[,٬_\s]/g, '').trim());
  const autoplayMs = Math.max(0, Math.min(20000, Math.round(parsedAutoplay || 0)));
  return {
    ...current,
    title: promoText(input.title !== undefined ? input.title : current.title, 120),
    subtitle: promoText(input.subtitle !== undefined ? input.subtitle : current.subtitle, 220),
    badge: promoText(input.badge !== undefined ? input.badge : current.badge, 48),
    image: imageRaw == null ? (current.image || '') : imageRaw,
    ctaLabel: promoText(input.ctaLabel !== undefined ? input.ctaLabel : current.ctaLabel, 64),
    actionType: PROMO_ACTION_TYPES.has(actionTypeRaw) ? actionTypeRaw : 'none',
    actionValue: promoText(input.actionValue !== undefined ? input.actionValue : current.actionValue, 500),
    kind: PROMO_KINDS.has(kindRaw) ? kindRaw : 'general',
    placement: PROMO_PLACEMENTS.has(placementRaw) ? placementRaw : (PROMO_PLACEMENTS.has(current.placement) ? current.placement : 'entrance'),
    shareEnabled: input.shareEnabled !== undefined ? Boolean(input.shareEnabled) : current.shareEnabled !== false,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled !== false,
    status: (input.status !== undefined ? input.status : current.status) === 'draft' ? 'draft' : 'published',
    startAt: input.startAt !== undefined ? promoIso(input.startAt) : (current.startAt || null),
    endAt: input.endAt !== undefined ? promoIso(input.endAt) : (current.endAt || null),
    branchId,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : (Number(current.sortOrder) || 0),
    autoplayMs,
  };
}

function publicPromoSlides() {
  const nowMs = Date.now();
  return (db.promoSlides || [])
    .filter((slide) => {
      if (!slide || slide.enabled === false || slide.status === 'draft') return false;
      if (slide.startAt && new Date(slide.startAt).getTime() > nowMs) return false;
      if (slide.endAt && new Date(slide.endAt).getTime() < nowMs) return false;
      return true;
    })
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || Number(a.id) - Number(b.id))
    .map((slide) => ({
      id: slide.id,
      title: slide.title || '',
      subtitle: slide.subtitle || '',
      badge: slide.badge || '',
      image: slide.image || '',
      ctaLabel: slide.ctaLabel || '',
      actionType: slide.actionType || 'none',
      actionValue: slide.actionValue || '',
      kind: slide.kind || 'general',
      placement: PROMO_PLACEMENTS.has(slide.placement) ? slide.placement : 'entrance',
      shareEnabled: slide.shareEnabled !== false,
      branchId: slide.branchId == null ? null : Number(slide.branchId),
      autoplayMs: Number(slide.autoplayMs) || 0,
    }));
}

function categoryHasCover(c) {
  const cover = String(c?.coverImg || '').trim();
  return Boolean(cover) && !isDrinkTexturePath(cover);
}

/** Active site categories: not hidden and have a real food coverImg (items optional). */
function activeMenuCategories(data) {
  return (data.menuCategories || []).filter(
    (c) => c && !c.hiddenOnSite && categoryHasCover(c)
  );
}

function bumpMenuRevision(data) {
  data.menuRevision = Date.now();
  return data.menuRevision;
}

/** Derive carousel `products` from menu categories (single source of truth). */
function buildProductsFromMenu(data) {
  return activeMenuCategories(data).map((c, i) => {
    const title = String(c.title || '').trim();
    return {
      id: i + 1,
      menuCategoryId: c.id,
      name1: title,
      name2: '',
      title,
      shortDesc: String(c.shortDesc || '').trim(),
      longDesc: String(c.longDesc || '').trim(),
      coverImg: String(c.coverImg || '').trim(),
    };
  });
}

// ---- storage ----------------------------------------------------------
function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = require('./seed');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error(`[DB_CORRUPTION_DETECTED] Failed to parse ${DB_PATH}:`, err.message);
    const backupPath = `${DB_PATH}.corrupted.${Date.now()}`;
    try { fs.copyFileSync(DB_PATH, backupPath); } catch (_) {}
    const seed = require('./seed');
    data = JSON.parse(JSON.stringify(seed));
    try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch (_) {}
  }
  return migrateDb(data);
}

// Runs for both the local JSON snapshot and a PostgreSQL snapshot. Keeping
// the migration idempotent gives staged rollouts a safe route forward and a
// local JSON rollback path without data loss.
function migrateDb(data) {
  // Migrate older db.json files that predate menu/orders.
  const seed = require('./seed');
  if (!data.settings || typeof data.settings !== 'object') {
    data.settings = seed.settings || {};
  }
  if (!Array.isArray(data.settings.adminPhones)) data.settings.adminPhones = [];
  data.settings.adminPhones = data.settings.adminPhones
    .map((phone) => normalizeDigits(String(phone || '')).trim())
    .filter(Boolean); // [TEMPORARILY REMOVED platform filter FOR DEV]
  // for (const user of Array.isArray(data.users) ? data.users : []) {
  //   if (isPlatformOnlyIdentity(user)) user.role = 'guest';
  // }
  if (!Array.isArray(data.menuItems)) data.menuItems = seed.menuItems;
  if (!Array.isArray(data.orders)) data.orders = [];
  // Migrate to the full Jan Majnoon-based menu (categories + items).
  if (!Array.isArray(data.menuCategories)) {
    data.menuCategories = seed.menuCategories;
    data.menuItems = seed.menuItems;
  }
  if (!Array.isArray(data.menuComplements)) {
    data.menuComplements = seed.menuComplements || [];
    data.menuComplementsV1Pending = true;
  }
  if (!Array.isArray(data.menuComplementRules)) {
    data.menuComplementRules = seed.menuComplementRules || [];
    data.menuComplementsV1Pending = true;
  }
  // Migrate carousel slides to menu-category names (one can per category).
  if (!data.productsV2) {
    data.products = seed.products;
    data.productsV2 = true;
  }
  // Migrate to one carousel slot per non-empty category (12 slots).
  if (!data.productsV3) {
    data.products = seed.products;
    data.productsV3 = true;
  }
  // Cafe ops layer (restaurant info, hours, tables, analytics, promos)
  if (!data.restaurant) data.restaurant = seed.restaurant;
  if (!data.hours) data.hours = seed.hours;
  if (!Array.isArray(data.tables)) data.tables = seed.tables;
  if (!Array.isArray(data.promotions)) data.promotions = seed.promotions || [];
  if (!Array.isArray(data.promoSlides)) data.promoSlides = [];
  if (!Array.isArray(data.visits)) data.visits = [];
  if (!data.visitSessions || typeof data.visitSessions !== 'object') data.visitSessions = {};
  if (!Array.isArray(data.waiterCalls)) data.waiterCalls = [];
  if (!Array.isArray(data.floorZones)) data.floorZones = [];
  if (!Array.isArray(data.floorFixtures)) data.floorFixtures = [];
  if (!Array.isArray(data.floors)) data.floors = [];
  if (!Array.isArray(data.floorSettingsList)) data.floorSettingsList = [];
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.staffShifts)) data.staffShifts = [];
  if (!Array.isArray(data.cashSessions)) data.cashSessions = [];
  if (!Array.isArray(data.newsletter)) data.newsletter = [];
  if (!Array.isArray(data.feedback)) data.feedback = [];
  if (!Array.isArray(data.walletTopupRequests)) data.walletTopupRequests = [];
  if (!Array.isArray(data.loyaltyLedger)) data.loyaltyLedger = [];
  if (!Array.isArray(data.walletLedger)) data.walletLedger = [];
  if (process.env.NODE_ENV !== 'production') {
    const operationalUsers = [
      { phone: '09120000101', name: 'صندوق‌دار وستو', role: 'cashier' },
      { phone: '09120000102', name: 'گارسون وستو', role: 'waiter' },
      { phone: '09120000103', name: 'آشپز وستو', role: 'kitchen' },
    ];
    for (const profile of operationalUsers) {
      if (data.users.some((user) => user.phone === profile.phone)) continue;
      data.users.push({
        ...profile,
        email: '',
        points: 0,
        createdAt: new Date().toISOString(),
        blocked: false,
        operationalDemo: true,
      });
    }
  }
  // Allergen + daypart fields on menu items
  for (const m of data.menuItems || []) {
    if (!Array.isArray(m.allergens)) m.allergens = [];
    if (!Array.isArray(m.dayparts) || !m.dayparts.length) m.dayparts = ['all'];
    if (m.stock === undefined) m.stock = null; // null = نامحدود
    if (typeof m.lowStockAt !== 'number') m.lowStockAt = 5;
    if (typeof m.en !== 'string') m.en = '';
    if (typeof m.descEn !== 'string') m.descEn = '';
    if (typeof m.ar !== 'string') m.ar = '';
    if (typeof m.descAr !== 'string') m.descAr = '';
    if (m.modifierGroups !== undefined && !Array.isArray(m.modifierGroups)) delete m.modifierGroups;
  }
  for (const complement of data.menuComplements || []) {
    complement.name = String(complement.name || '').trim().slice(0, 120);
    complement.price = Math.max(0, Math.round(Number(complement.price) || 0));
    complement.available = complement.available !== false;
    complement.stock = complement.stock == null || complement.stock === '' ? null : Math.max(0, Math.round(Number(complement.stock) || 0));
    complement.lowStockAt = Math.max(0, Math.round(Number(complement.lowStockAt) || 5));
    complement.img = sanitizeMenuImg(complement.img) || '';
  }
  for (const rule of data.menuComplementRules || []) {
    rule.name = String(rule.name || '').trim().slice(0, 120);
    rule.prompt = String(rule.prompt || '').trim().slice(0, 180);
    rule.sourceCategoryIds = [...new Set((Array.isArray(rule.sourceCategoryIds) ? rule.sourceCategoryIds : []).map(Number).filter(Number.isFinite))];
    rule.sourceItemIds = [...new Set((Array.isArray(rule.sourceItemIds) ? rule.sourceItemIds : []).map(Number).filter(Number.isFinite))];
    rule.complementIds = [...new Set((Array.isArray(rule.complementIds) ? rule.complementIds : []).map(Number).filter(Number.isFinite))];
    rule.active = rule.active !== false;
  }
  if (!data.i18n || typeof data.i18n !== 'object') {
    data.i18n = {
      guestLangEnabled: true,
      defaultLang: 'fa',
      supported: ['fa', 'en', 'ar'],
    };
  } else {
    if (!Array.isArray(data.i18n.supported) || !data.i18n.supported.includes('ar')) {
      data.i18n.supported = ['fa', 'en', 'ar'];
    }
    if (!['fa', 'en', 'ar'].includes(data.i18n.defaultLang)) data.i18n.defaultLang = 'fa';
  }
  if (!data.loyalty || typeof data.loyalty !== 'object') {
    data.loyalty = {
      enabled: true,
      pointsPerToman: 0.01,
      redeemValue: 1000,
      welcomePoints: 50,
    };
  }
  if (!Array.isArray(data.loyaltyLedger)) data.loyaltyLedger = [];
  if (!data.salsaIntegration && data.neemIntegration) {
    data.salsaIntegration = data.neemIntegration;
  }
  if (!data.salsaIntegration || typeof data.salsaIntegration !== 'object') {
    data.salsaIntegration = {
      enabled: true,
      endpoint: '',
      outbox: [],
      lastError: '',
      tenantId: TENANT_CONFIG.tenantId,
      schemaVersion: 1,
      mode: 'outbox',
    };
  }
  if (!Array.isArray(data.salsaIntegration.outbox)) data.salsaIntegration.outbox = [];
  data.salsaIntegration.tenantId = TENANT_CONFIG.tenantId;
  data.salsaIntegration.schemaVersion = 1;
  data.salsaIntegration.mode = 'outbox';
  data.neemIntegration = data.salsaIntegration;
  data.tenantIdentity = {
    tenantId: TENANT_CONFIG.tenantId,
    tenantSlug: TENANT_CONFIG.tenantSlug,
    canonicalDomain: TENANT_CONFIG.canonicalDomain,
    cellId: TENANT_CONFIG.cellId,
    storageMode: 'database-per-tenant',
  };
  for (const u of data.users || []) {
    if (typeof u.points !== 'number') u.points = 0;
  }
  if (!data.theme || typeof data.theme !== 'object') {
    data.theme = {
      accent: '#78d0d8',
      accentInk: '#0a1a1c',
      surface: '#111318',
      bg: '#08090b',
      fog: '#ece8e2',
      printPaper: '#f7f3ec',
      printInk: '#1a1714',
      printAccent: '#2a7a86',
      radius: 14,
      fontDisplay: 'Vazirmatn',
    };
  }
  // Multi-branch: migrate single venue into branches[]
  if (!Array.isArray(data.branches) || !data.branches.length) {
    const r = data.restaurant || seed.restaurant || {};
    data.branches = [
      {
        id: 1,
        slug: 'main',
        name: 'شعبه اصلی',
        address: r.address || '',
        phone: r.phone || '',
        whatsapp: r.whatsapp || '',
        active: true,
        hours: JSON.parse(JSON.stringify(data.hours || seed.hours)),
      },
    ];
  }
  const primaryBranchId = data.branches[0].id;
  for (const b of data.branches) {
    if (!b.hours || typeof b.hours !== 'object') {
      b.hours = JSON.parse(JSON.stringify(data.hours || seed.hours));
    }
    if (typeof b.active !== 'boolean') b.active = true;
    if (!b.slug) b.slug = `branch-${b.id}`;
  }
  for (const t of data.tables || []) {
    if (t.branchId == null) t.branchId = primaryBranchId;
  }
  for (const o of data.orders || []) {
    if (o.branchId == null) o.branchId = primaryBranchId;
  }
  for (const c of data.waiterCalls || []) {
    if (c.branchId == null) c.branchId = primaryBranchId;
  }
  // Keep legacy hours mirror of first active branch
  const mirror = data.branches.find((b) => b.active !== false) || data.branches[0];
  if (mirror?.hours) data.hours = mirror.hours;
  ensurePrintingData(data, primaryBranchId);
  if (!data.reservationSettings || typeof data.reservationSettings !== 'object') {
    data.reservationSettings = {
      enabled: true,
      slotMinutes: 30,
      maxParty: 12,
      maxCoversPerSlot: 24,
      advanceDays: 21,
      minHoursAhead: 1,
    };
  }
  if (!Array.isArray(data.reservations)) data.reservations = [];
  for (const r of data.reservations) {
    if (r.branchId == null) r.branchId = primaryBranchId;
    if (!r.status) r.status = 'pending';
  }
  if (!data.whatsappNotify || typeof data.whatsappNotify !== 'object') {
    data.whatsappNotify = {
      enabled: true,
      onOrder: true,
      onReservation: true,
      phone: data.restaurant?.whatsapp || data.restaurant?.phone || '',
    };
  }
  if (!Array.isArray(data.whatsappLog)) data.whatsappLog = [];
  if (!data.feedbackSettings || typeof data.feedbackSettings !== 'object') {
    data.feedbackSettings = {
      enabled: true,
      askAfterOrder: true,
      title: 'نظر شما برای ما مهم است',
      subtitle: 'از ۰ تا ۱۰، چقدر ما را به دوستان‌تان پیشنهاد می‌کنید؟',
      thankYou: 'ممنون از بازخوردتان',
    };
  }
  if (!Array.isArray(data.feedback)) data.feedback = [];

  // Command-center data is additive so the legacy JSON snapshot can still be
  // opened by previous releases during the staged PostgreSQL rollout.
  if (!Array.isArray(data.deliveryZones)) data.deliveryZones = seed.deliveryZones || [];
  if (!Array.isArray(data.paymentAttempts)) data.paymentAttempts = [];
  if (!data.checkoutIdempotency || typeof data.checkoutIdempotency !== 'object') data.checkoutIdempotency = {};
  if (!Array.isArray(data.auditLog)) data.auditLog = [];
  if (!data.commandCenter || typeof data.commandCenter !== 'object') {
    data.commandCenter = { schemaVersion: 1, eventRevision: 0 };
  }
  for (const user of data.users || []) {
    // Never rewrite the legacy role on disk here: normalizeRole preserves a
    // reversible compatibility path while all new API responses are RBAC-safe.
    if (!user.role) user.role = 'user';
  }
  for (const order of data.orders || []) {
    order.fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
    order.paymentStatus = paymentStatusFor(order);
    if (!Array.isArray(order.statusHistory)) {
      order.statusHistory = [{
        status: order.status || initialOrderStatus(order),
        at: order.createdAt || new Date().toISOString(),
        by: null,
      }];
    }
  }

  // Normalize menu category marketing / site-visibility fields
  if (!Array.isArray(data.menuCategories)) data.menuCategories = [];
  for (const c of data.menuCategories) {
    if (typeof c.name1 !== 'string') c.name1 = '';
    if (typeof c.name2 !== 'string') c.name2 = '';
    if (typeof c.shortDesc !== 'string') c.shortDesc = '';
    if (typeof c.longDesc !== 'string') c.longDesc = '';
    if (typeof c.hiddenOnSite !== 'boolean') c.hiddenOnSite = false;
    if (typeof c.coverImg !== 'string') c.coverImg = '';
  }
  if (typeof data.menuRevision !== 'number') data.menuRevision = Date.now();

  // coverImgV1: scrub drink-label textures, backfill covers from first dish,
  // and set a real matcha hero cover (replaces Giro kiwi placeholder).
  if (!data.coverImgV1) {
    const MATCHA_ID = 14477;
    const MATCHA_COVER = 'assets/menu/matcha-cover.webp';
    for (const m of data.menuItems || []) {
      if (m && isDrinkTexturePath(m.img)) m.img = '';
    }
    const firstImgByCat = Object.create(null);
    for (const m of data.menuItems || []) {
      if (!m || m.available === false) continue;
      const img = String(m.img || '').trim();
      if (!img || isDrinkTexturePath(img)) continue;
      const id = Number(m.categoryId);
      if (!firstImgByCat[id]) firstImgByCat[id] = img;
    }
    for (const c of data.menuCategories || []) {
      if (isDrinkTexturePath(c.coverImg)) c.coverImg = '';
      if (!String(c.coverImg || '').trim() && firstImgByCat[Number(c.id)]) {
        c.coverImg = firstImgByCat[Number(c.id)];
      }
    }
    const matcha = (data.menuCategories || []).find((c) => Number(c.id) === MATCHA_ID);
    if (matcha) matcha.coverImg = MATCHA_COVER;
    data.menuRevision = Date.now();
    data.coverImgV1 = true;
  }

  // coverTitleV1: hero/classic display uses category.title only (drop drink-era name1+name2).
  if (!data.coverTitleV1) {
    const MATCHA_ID = 14477;
    for (const c of data.menuCategories || []) {
      const title = String(c.title || '').trim();
      c.title = title || String(c.name1 || '').trim() || 'بدون عنوان';
      c.name1 = c.title;
      c.name2 = '';
    }
    const matcha = (data.menuCategories || []).find((c) => Number(c.id) === MATCHA_ID);
    if (matcha) {
      matcha.title = 'ماچا بار';
      matcha.name1 = 'ماچا بار';
      matcha.name2 = '';
    }
    data.menuRevision = Date.now();
    data.coverTitleV1 = true;
  }

  // coverSanitizeV2: strip known non-food uploads (nail polymer / snails serum)
  // that were saved as category covers and broke the hero pairing.
  if (!data.coverSanitizeV2) {
    const BAD = new Set([
      'uploads/1784888458855-1a83e8ef-baa0-456e-8ff0-ed150e3b1ea5.png',
      'uploads/1784886930511-0e38d0f3-7450-4138-a4ef-154e1a3965e2.png',
    ]);
    for (const c of data.menuCategories || []) {
      const cover = String(c.coverImg || '').trim();
      if (!BAD.has(cover)) continue;
      const dishImg = (data.menuItems || []).find(
        (m) => m && m.categoryId === c.id && String(m.img || '').trim() && !BAD.has(String(m.img || '').trim()),
      );
      if (dishImg?.img) {
        c.coverImg = String(dishImg.img).trim();
      } else {
        c.coverImg = '';
        c.hiddenOnSite = true;
      }
    }
    data.products = buildProductsFromMenu(data);
    data.menuRevision = Date.now();
    data.coverSanitizeV2 = true;
  }

  // coverStabilityV1: drop leftover cosmetic covers; empty cats without a real
  // cover stay off the guest carousel; empty-with-cover stay empty-only.
  if (!data.coverStabilityV1) {
    const BAD_COVER = new Set([
      'uploads/1784888458855-1a83e8ef-baa0-456e-8ff0-ed150e3b1ea5.png',
      'uploads/1784886930511-0e38d0f3-7450-4138-a4ef-154e1a3965e2.png',
      // Extra cosmetic / non-food uploads seen during cover churn
      'uploads/1784888458855-1a83e8ef-baa0-456e-8ff0-ed150e3b1ea5.webp',
      'uploads/1784886930511-0e38d0f3-7450-4138-a4ef-154e1a3965e2.webp',
    ]);
    const looksCosmeticUpload = (cover) => {
      const c = String(cover || '').trim().toLowerCase();
      if (!c) return false;
      if (BAD_COVER.has(c)) return true;
      // Heuristic: admin-era nail/serum filenames sometimes embed brand tokens
      return /nuxe|snails|serum|nail|polymer|manicure|cuticle/i.test(c);
    };
    for (const c of data.menuCategories || []) {
      if (!c) continue;
      let cover = String(c.coverImg || '').trim();
      if (isDrinkTexturePath(cover) || looksCosmeticUpload(cover)) {
        cover = '';
        c.coverImg = '';
      }
      const hasAvail = (data.menuItems || []).some(
        (m) => m && Number(m.categoryId) === Number(c.id) && m.available !== false,
      );
      // No cover → not on guest carousel (activeMenuCategories). Hide empty husks
      // that also have no available dishes so admin lists stay clean.
      if (!categoryHasCover(c) && !hasAvail) {
        c.hiddenOnSite = true;
        c.coverImg = '';
      }
    }
    data.products = buildProductsFromMenu(data);
    data.menuRevision = Date.now();
    data.coverStabilityV1 = true;
  }

  // coverMissingV1: replace deleted upload covers (matcha / caffeine) with
  // dedicated assets so catbar thumbs never point at missing files.
  if (!data.coverMissingV1) {
    const MATCHA_ID = 14477;
    const CAFFEINE_ID = 7675;
    const MATCHA_COVER = 'assets/menu/matcha-cover.webp';
    const CAFFEINE_COVER = 'assets/menu/caffeine-cover.webp';
    const MISSING_UPLOAD_MAP = {
      'uploads/1784892283596-matchafinal.webp': MATCHA_COVER,
      'uploads/1784892333322-matcha.webp': MATCHA_COVER,
      'uploads/1784888699038-0bf3e359-9e85-463d-a070-4d4bd6985a22.png': CAFFEINE_COVER,
    };
    const mediaExists = (rel) => {
      const s = String(rel || '').trim();
      if (!s) return false;
      if (/^https?:\/\//i.test(s)) return true;
      try {
        return fs.existsSync(path.join(ROOT, s));
      } catch (_) {
        return false;
      }
    };
    for (const c of data.menuCategories || []) {
      if (!c) continue;
      const id = Number(c.id);
      let cover = String(c.coverImg || '').trim();
      if (MISSING_UPLOAD_MAP[cover]) cover = MISSING_UPLOAD_MAP[cover];
      if (id === MATCHA_ID) cover = MATCHA_COVER;
      else if (id === CAFFEINE_ID) cover = CAFFEINE_COVER;
      else if (cover && !mediaExists(cover)) {
        const dish = (data.menuItems || []).find(
          (m) =>
            m &&
            Number(m.categoryId) === id &&
            mediaExists(String(m.img || '').trim()) &&
            !isDrinkTexturePath(m.img),
        );
        cover = dish ? String(dish.img).trim() : '';
      }
      c.coverImg = cover;
    }
    for (const m of data.menuItems || []) {
      if (!m) continue;
      const img = String(m.img || '').trim();
      if (MISSING_UPLOAD_MAP[img]) m.img = MISSING_UPLOAD_MAP[img];
      else if (img && !mediaExists(img) && Number(m.categoryId) === MATCHA_ID) {
        m.img = MATCHA_COVER;
      } else if (img && !mediaExists(img) && Number(m.categoryId) === CAFFEINE_ID) {
        m.img = CAFFEINE_COVER;
      }
    }
    data.products = buildProductsFromMenu(data);
    data.menuRevision = Date.now();
    data.coverMissingV1 = true;
  }

  // productsV4: copy marketing text from legacy products onto matching menuCategories,
  // then rebuild products as a derived mirror of non-empty visible categories.
  if (!data.productsV4) {
    const normalizeTitle = (s) =>
      String(s || '')
        .replace(/\s+/g, ' ')
        .trim();
    const productByTitle = Object.create(null);
    for (const p of data.products || []) {
      const full = normalizeTitle(`${p.name1 || ''} ${p.name2 || ''}`);
      const n1 = normalizeTitle(p.name1);
      if (full) productByTitle[full] = p;
      if (n1) productByTitle[n1] = p;
    }
    for (const c of data.menuCategories) {
      const match = productByTitle[normalizeTitle(c.title)];
      if (!match) continue;
      if (!c.name1 && match.name1) c.name1 = match.name1;
      if (!c.name2 && match.name2) c.name2 = match.name2;
      if (!c.shortDesc && match.shortDesc) c.shortDesc = match.shortDesc;
      if (!c.longDesc && match.longDesc) c.longDesc = match.longDesc;
    }
    data.products = buildProductsFromMenu(data);
    data.productsV4 = true;
  }

  // Accounting subsystem schema and data structures
  accountingEngine.ensureAccountingData(data);

  return data;
}
const defaultDb = loadDb();
const tenantRegistry = new TenantRegistry(defaultDb, DB_PATH);
const TENANT_INFRASTRUCTURE_ENABLED = TENANT_CONFIG.multiTenant
  || (process.env.SALSA_TENANT_CONTEXT_MODE || process.env.NEEM_TENANT_CONTEXT_MODE) === 'control-db';

let runtimeControlDataAccess = null;
let closeRuntimeControlDatabase = async () => {};
if (TENANT_INFRASTRUCTURE_ENABLED && (process.env.SALSA_CONTROL_DATABASE_URL || process.env.NEEM_CONTROL_DATABASE_URL)) {
  const controlDatabase = require('./salsa/control-plane/db/database');
  runtimeControlDataAccess = new ControlDataAccess({ pool: controlDatabase.getDatabase() });
  closeRuntimeControlDatabase = controlDatabase.closeDatabase;
}

const tenantResolver = new TenantResolver({
  controlDataAccess: runtimeControlDataAccess,
  baseDomain: process.env.SALSA_PLATFORM_BASE_DOMAIN || process.env.NEEM_PLATFORM_BASE_DOMAIN || 'salsa.ir',
  defaultTenant: TENANT_CONFIG.tenantId,
  defaultHosts: TENANT_CONFIG.hosts,
  localHostTenant: TENANT_CONFIG.tenantId,
  allowLocalDevelopment: process.env.NODE_ENV !== 'production',
  trustForwardedHost: (process.env.SALSA_TRUST_PROXY || process.env.NEEM_TRUST_PROXY) === 'true',
  logger: console,
});
const tenantConnectionManager = new TenantConnectionManager({
  baseUrl: process.env.SALSA_TENANT_DB_POSTGRES_URL || process.env.NEEM_TENANT_DB_POSTGRES_URL,
  logger: console,
});

function multiTenantHostMiddleware(req, res, next) {
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const tenantId = tenantRegistry.resolveTenantIdForHost(rawHost, {
    defaultTenantId: TENANT_CONFIG.tenantId,
    defaultHosts: TENANT_CONFIG.hosts,
  });

  // A public host is never allowed to create a tenant merely by being
  // requested. Tenant provisioning is an authenticated control-plane action.
  if (!tenantId) {
    return res.status(404).json({
      ok: false,
      error: 'unknown_tenant_host',
      message: 'این دامنه به هیچ رستوران فعال در پلتفرم متصل نیست.',
    });
  }

  const tenantDb = tenantRegistry.getTenantDb(tenantId);
  if (!tenantDb) {
    return res.status(404).json({
      ok: false,
      error: 'tenant_storage_not_registered',
      message: 'ذخیره‌سازی این tenant ثبت نشده است.',
    });
  }
  const identity = tenantDb.tenantIdentity || {};
  req.tenant = {
    ...TENANT_CONFIG,
    tenantId,
    tenantSlug: identity.tenantSlug || tenantId,
    displayName: identity.displayName || tenantDb.restaurant?.name || tenantId,
    canonicalDomain: identity.canonicalDomain || `${tenantId}.salsa.ir`,
  };
  req.tenantHostMatched = true;
  req.tenantSlug = req.tenant.tenantSlug;
  req.tenantId = tenantId;
  next();
}

const db = new Proxy(defaultDb, {
  get(target, prop) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.get(current, prop);
  },
  set(target, prop, value) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.set(current, prop, value);
  },
  has(target, prop) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.has(current, prop);
  },
  ownKeys(target) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.ownKeys(current);
  },
  getOwnPropertyDescriptor(target, prop) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.getOwnPropertyDescriptor(current, prop);
  }
});

const stateStore = createPostgresStateStore({
  logger: console,
  tenantConfig: TENANT_CONFIG,
  requireTenantMetadata: TENANT_CONFIG.requireMetadata,
  required: process.env.WESTO_POSTGRES_REQUIRED === 'true'
    || TENANT_CONFIG.multiTenant
    || TENANT_CONFIG.requireMetadata,
});
const eventHub = createEventHub();
const settlementPersistenceGate = createSettlementPersistenceGate();
let saveTimer = null;
let saveWaiters = [];

function rebuildProductsFromMenu() {
  const store = tenantStorage.getStore();
  const currentDb = (store && store.db) ? store.db : defaultDb;
  currentDb.products = buildProductsFromMenu(currentDb);
}

function shouldWriteJsonState() {
  // Multi-tenant production cells must not silently keep JSON as a second
  // writable authority. JSON remains useful for local recovery and shadow
  // migrations, but the cutover flag makes PostgreSQL the only authority.
  if (TENANT_CONFIG.multiTenant && process.env.NODE_ENV === 'production') return false;
  // Importing the legacy Express app is common in unit/HTTP tests. Never let
  // those tests rewrite the operator's checkout database; an integration test
  // that intentionally points WESTO_DB_PATH at a disposable file must opt in.
  if (IS_NODE_TEST_RUNTIME) {
    return process.env.WESTO_ALLOW_TEST_DB_WRITE === 'true'
      && path.resolve(DB_PATH) !== path.resolve(DEFAULT_JSON_DB_PATH);
  }
  return !stateStore.enabled || process.env.WESTO_JSON_RECOVERY_SNAPSHOT === 'true';
}

function save(opts = {}) {
  const store = tenantStorage.getStore();
  const currentDb = (store && store.db) ? store.db : defaultDb;
  const currentTenantId = (store && store.tenantId) ? store.tenantId : 'westo';

  if (opts.rebuildProducts) rebuildProductsFromMenu();
  if (opts.rebuildProducts || opts.bumpMenu) bumpMenuRevision(currentDb);

  if (currentTenantId !== 'westo') {
    const persistenceError = legacyTenantPersistenceError({ tenantId: currentTenantId });
    if (persistenceError) {
      return opts.requireDurable ? Promise.reject(persistenceError) : Promise.resolve(false);
    }
    try {
      const persisted = tenantRegistry.saveTenantDb(currentTenantId, { requireDurable: opts.requireDurable === true });
      if (opts.requireDurable && persisted !== true) {
        throw Object.assign(new Error('Tenant state was not persisted.'), { code: 'tenant_persistence_failed', status: 503 });
      }
      return Promise.resolve(persisted !== false);
    } catch (error) {
      if (!opts.requireDurable) return Promise.resolve(false);
      return Promise.reject(Object.assign(error, {
        code: error.code || 'tenant_persistence_failed',
        status: error.status || 503,
      }));
    }
  }

  const waiter = new Promise((resolve, reject) => {
    saveWaiters.push({ resolve, reject, requireDurable: opts.requireDurable === true });
  });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const batch = saveWaiters;
    saveWaiters = [];
    let persistenceError = null;
    let persistenceAttempted = false;
    if (shouldWriteJsonState()) {
      persistenceAttempted = true;
      try {
        const encoded = JSON.stringify(db, null, 2);
        const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, encoded, { mode: 0o600 });
        fs.renameSync(tmpPath, DB_PATH);
      } catch (error) {
        persistenceError = error;
        console.error('[storage] unable to write JSON snapshot', error.message);
      }
    }
    if (stateStore.enabled) {
      persistenceAttempted = true;
      try {
        const persisted = await stateStore.write(db);
        if (persisted !== true) {
          throw Object.assign(new Error('PostgreSQL state store did not confirm a durable write.'), {
            code: 'persistence_unconfirmed',
            status: 503,
          });
        }
      } catch (error) {
        persistenceError = error;
        settlementPersistenceGate.recordFailure(error);
        console.error('[postgres] unable to persist state', error.message);
      }
    }
    if (!persistenceAttempted) {
      persistenceError = Object.assign(new Error('No durable persistence backend is available.'), {
        code: 'persistence_unavailable',
        status: 503,
      });
    }
    for (const pending of batch) {
      if (persistenceError && pending.requireDurable) pending.reject(Object.assign(persistenceError, { code: persistenceError.code || 'finance_persistence_failed', status: persistenceError.status || 503 }));
      else pending.resolve(!persistenceError);
    }
  }, 50);
  return waiter;
}

// Critical operational routes update the order/cash snapshot and Finance V2
// together. Keep a bounded rollback image so a failed durable write or a
// finance invariant cannot leave an in-memory paid order without its ledger.
const FINANCE_MUTATION_STATE_KEYS = Object.freeze([
  'financeV2', 'accounting', 'orders', 'cashSessions', 'staffShifts', 'paymentAttempts', 'auditLog',
  'users', 'walletLedger', 'walletTopupRequests', 'loyaltyLedger', 'loyaltyAchievementAwards', 'referrals', 'campaignLog', 'smsLog', 'menuItems', 'menuComplements', 'checkoutIdempotency',
  'menuAvailabilityOverrides', 'menuRevision', 'waiterCalls',
]);
const settlementInFlight = new Map();
function persistedOrderBranchId(order) {
  const value = order?.branchId;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = normalizeDigits(value).trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const branchId = Number(normalized);
  return Number.isSafeInteger(branchId) && branchId > 0 ? branchId : null;
}

function settlementLockKey(req, order, idempotencyKey, branchId = order?.branchId) {
  return createSettlementInFlightKey({
    tenantId: req?.tenantId || req?.tenantContext?.tenantId || req?.tenant?.tenantId,
    branchId,
    orderId: order?.id,
    idempotencyKey,
  });
}

function snapshotFinanceMutationState() {
  return Object.fromEntries(FINANCE_MUTATION_STATE_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(db, key) && db[key] !== undefined
      ? JSON.parse(JSON.stringify(db[key]))
      : undefined,
  ]));
}

function restoreFinanceMutationState(snapshot) {
  for (const [key, before] of Object.entries(snapshot || {})) {
    if (before === undefined) delete db[key];
    else db[key] = before;
  }
}

async function persistFinanceMutation(snapshot, options = {}) {
  try {
    await save({ ...options, requireDurable: true });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    // A JSON recovery snapshot may have been written before a later durable
    // backend failed. Persist the restored image as well so a failed order
    // commit cannot survive a restart through that secondary snapshot.
    try {
      await save({ ...options, requireDurable: true });
    } catch (rollbackError) {
      console.error('[persistence] rollback snapshot write failed', rollbackError?.message || rollbackError);
    }
    throw error;
  }
}

const adminConfigMutationQueues = new Map();
const branchOrderMutationQueues = new Map();
const orderMutationQueues = new Map();
const checkoutOrderMutationQueues = new Map();

async function serializeOrderMutation(req, branchId, orderId, operation) {
  const tenantId = String(
    tenantStorage.getStore()?.tenantId
      || req?.tenantId
      || req?.tenantContext?.tenantId
      || req?.tenant?.tenantId
      || TENANT_CONFIG.tenantId
      || 'westo',
  );
  const branch = Number(branchId);
  const id = Number(orderId);
  if (!tenantId || !Number.isSafeInteger(branch) || branch <= 0
      || !Number.isSafeInteger(id) || id <= 0 || typeof operation !== 'function') {
    throw Object.assign(new Error('Order mutation identity is invalid.'), {
      code: 'order_mutation_identity_invalid', status: 409,
    });
  }
  const key = JSON.stringify([tenantId, branch, id]);
  const previous = orderMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  orderMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (orderMutationQueues.get(key) === current) orderMutationQueues.delete(key);
  }
}

async function serializeBranchOrderMutation(order, operation) {
  const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
  // Serialize snapshot-backed order commits within a branch. This also keeps
  // acceptance idempotency references unique across different order ids.
  const key = `${tenantId}:${Number(order?.branchId)}`;
  const previous = branchOrderMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  branchOrderMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (branchOrderMutationQueues.get(key) === current) branchOrderMutationQueues.delete(key);
  }
}

async function serializeCheckoutOrderMutation(tenantId, idempotencyKey, operation) {
  const key = JSON.stringify([String(tenantId || 'westo'), String(idempotencyKey || '')]);
  const previous = checkoutOrderMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  checkoutOrderMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (checkoutOrderMutationQueues.get(key) === current) checkoutOrderMutationQueues.delete(key);
  }
}

function serializeOrderMutationRoute(handler) {
  return (req, res, next) => {
    const targetId = Number(normalizeDigits(String(req.params?.id || '')).replace(/\D/g, ''));
    const order = (db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return handler(req, res, next);
    return serializeBranchOrderMutation(order, () => handler(req, res, next)).catch((error) => {
      if (res.headersSent) return undefined;
      return res.status(error.status || 503).json({ error: error.code || 'order_mutation_failed', message: error.message });
    });
  };
}

function serializePaymentOrderMutationRoute(handler) {
  return (req, res, next) => {
    const paymentId = Number(normalizeDigits(String(req.params?.id || req.body?.paymentAttemptId || '')).replace(/\D/g, ''));
    const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === paymentId);
    const order = payment && (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
    if (!order) return handler(req, res, next);
    return serializeBranchOrderMutation(order, () => handler(req, res, next)).catch((error) => {
      if (res.headersSent) return undefined;
      return res.status(error.status || 503).json({ error: error.code || 'payment_order_mutation_failed', message: error.message });
    });
  };
}

async function serializeAdminConfigMutation(branchId, operation) {
  const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
  const key = `${tenantId}:${Number(branchId)}`;
  const previous = adminConfigMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  adminConfigMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (adminConfigMutationQueues.get(key) === current) adminConfigMutationQueues.delete(key);
  }
}

async function persistAdminConfigMutation(rollback) {
  try {
    await save({ requireDurable: true });
  } catch (error) {
    try { rollback?.(); } catch (rollbackError) {
      console.error('[admin-config] rollback failed', rollbackError?.message || rollbackError);
    }
    throw error;
  }
}

if (db.menuComplementsV1Pending) {
  delete db.menuComplementsV1Pending;
  save({ bumpMenu: true });
}
const salsaBridge = createSalsaBridge({
  getDb: () => db,
  persist: () => save(),
  logger: console,
  tenantConfig: TENANT_CONFIG,
});
const neemBridge = salsaBridge;
// Keep derived products in sync with current menu
rebuildProductsFromMenu();
if (!stateStore.enabled) save(); // persist migrations if any

// ---- session (HMAC-signed cookie) -------------------------------------
if (!fs.existsSync(SECRET_PATH)) {
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
try { fs.chmodSync(SECRET_PATH, 0o600); } catch (_) {}
const SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
const SESSION_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.WESTO_SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000);

const ALLERGENS = [
  { id: 'gluten', label: 'گلوتن', labelEn: 'Gluten', labelAr: 'غلوتين' },
  { id: 'dairy', label: 'لبنیات', labelEn: 'Dairy', labelAr: 'ألبان' },
  { id: 'egg', label: 'تخم‌مرغ', labelEn: 'Egg', labelAr: 'بيض' },
  { id: 'nuts', label: 'آجیل درختی', labelEn: 'Tree nuts', labelAr: 'مكسرات' },
  { id: 'peanut', label: 'بادام‌زمینی', labelEn: 'Peanut', labelAr: 'فول سوداني' },
  { id: 'soy', label: 'سویا', labelEn: 'Soy', labelAr: 'صويا' },
  { id: 'seafood', label: 'دریایی / صدف', labelEn: 'Seafood / shellfish', labelAr: 'مأكولات بحرية' },
  { id: 'sesame', label: 'کنجد', labelEn: 'Sesame', labelAr: 'سمسم' },
  { id: 'mustard', label: 'خردل', labelEn: 'Mustard', labelAr: 'خردل' },
];

const DAYPARTS = [
  { id: 'all', label: 'همیشه', hours: null },
  { id: 'breakfast', label: 'صبحانه', hours: [6, 11] },
  { id: 'lunch', label: 'ناهار', hours: [11, 16] },
  { id: 'dinner', label: 'شام', hours: [16, 23] },
  { id: 'late', label: 'دیروقت', hours: [23, 6] },
];

function defaultHoursTemplate() {
  return JSON.parse(
    JSON.stringify({
      sat: { open: '10:00', close: '23:30', closed: false },
      sun: { open: '10:00', close: '23:30', closed: false },
      mon: { open: '10:00', close: '23:30', closed: false },
      tue: { open: '10:00', close: '23:30', closed: false },
      wed: { open: '10:00', close: '23:30', closed: false },
      thu: { open: '10:00', close: '00:30', closed: false },
      fri: { open: '10:00', close: '00:30', closed: false },
    })
  );
}

function defaultBranch() {
  return (db.branches || []).find((b) => b.active !== false) || (db.branches || [])[0] || null;
}

function tableBranchId(table) {
  return Number(table?.branchId) || Number(defaultBranch()?.id) || 1;
}

function resolveBranch(q) {
  if (q == null || q === '') return defaultBranch();
  const cleanQ = normalizeDigits(String(q)).trim();
  const id = Number(cleanQ);
  if (Number.isFinite(id) && id > 0) {
    return (db.branches || []).find((b) => Number(b.id) === id) || defaultBranch();
  }
  const slug = cleanQ.toLowerCase();
  return (db.branches || []).find((b) => String(b.slug || '').toLowerCase() === slug) || defaultBranch();
}

function requestBranchValue(req) {
  const values = [req.query?.branchId, req.query?.branch, req.body?.branchId, req.body?.branch];
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? null;
}

function resolveBranchExact(value) {
  if (value == null || String(value).trim() === '') return defaultBranch();
  const cleanVal = normalizeDigits(String(value)).trim();
  const id = Number(cleanVal);
  if (Number.isFinite(id) && id > 0) return (db.branches || []).find((branch) => Number(branch.id) === id) || null;
  const slug = cleanVal.toLowerCase();
  return (db.branches || []).find((branch) => String(branch.slug || '').trim().toLowerCase() === slug) || null;
}

function branchScopeError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function assertRequestBranchAccess(req) {
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  if (allowedBranchIds !== null && !allowedBranchIds.length) {
    throw branchScopeError('branch_scope_empty', 403, 'برای این کاربر هیچ شعبهٔ مجازی مجاز تعریف نشده است.');
  }
  const raw = requestBranchValue(req);
  if (raw == null) return;
  const branch = resolveBranchExact(raw);
  if (!branch) throw branchScopeError('branch_invalid', 400, 'شعبهٔ انتخاب‌شده معتبر نیست.');
  if (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branch.id))) {
    throw branchScopeError('branch_access_denied', 403, 'دسترسی به شعبهٔ انتخاب‌شده مجاز نیست.');
  }
}

function parseBranchId(req) {
  const raw = requestBranchValue(req);
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  if (raw == null) {
    if (allowedBranchIds !== null) {
      if (!allowedBranchIds.length) return null;
      const preferred = defaultBranch();
      return preferred && allowedBranchIds.includes(Number(preferred.id)) ? preferred.id : allowedBranchIds[0];
    }
    const preferred = defaultBranch();
    return preferred ? preferred.id : null;
  }
  const branch = resolveBranchExact(raw);
  if (!branch) throw branchScopeError('branch_invalid', 400, 'شعبهٔ انتخاب‌شده معتبر نیست.');
  if (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branch.id))) {
    throw branchScopeError('branch_access_denied', 403, 'دسترسی به شعبهٔ انتخاب‌شده مجاز نیست.');
  }
  return branch.id;
}

function syncLegacyHours() {
  const b = defaultBranch();
  if (b?.hours) db.hours = b.hours;
}

function currentDaypartIds(date = new Date()) {
  const h = date.getHours();
  const active = [];
  for (const d of DAYPARTS) {
    if (!d.hours) continue;
    const [a, b] = d.hours;
    if (a < b) {
      if (h >= a && h < b) active.push(d.id);
    } else if (h >= a || h < b) active.push(d.id);
  }
  return active;
}

function itemVisibleNow(item) {
  const parts = Array.isArray(item.dayparts) && item.dayparts.length ? item.dayparts : ['all'];
  if (parts.includes('all')) return true;
  const now = currentDaypartIds();
  return parts.some((p) => now.includes(p));
}

function normalizeAllergens(list) {
  if (!Array.isArray(list)) return [];
  const allowed = new Set(ALLERGENS.map((a) => a.id));
  return [...new Set(list.map(String).filter((id) => allowed.has(id)))];
}

function normalizeDayparts(list) {
  if (!Array.isArray(list) || !list.length) return ['all'];
  const allowed = new Set(DAYPARTS.map((d) => d.id));
  const next = [...new Set(list.map(String).filter((id) => allowed.has(id)))];
  return next.length ? next : ['all'];
}

function makeToken(phone, tenantId = TENANT_CONFIG.tenantId) {
  return createSessionToken({
    phone,
    tenantId: normalizeTenantId(tenantId || TENANT_CONFIG.tenantId),
  }, SECRET);
}
function parseToken(token, expectedTenantId) {
  const parsed = readSessionToken(token, SECRET);
  if (!parsed || !sessionTokenMatchesTenant(parsed, expectedTenantId, {
    requireTenantClaim: TENANT_INFRASTRUCTURE_ENABLED,
  })) return null;
  return parsed;
}
function getCookie(req, name) {
  if (!req || !req.headers || !req.headers.cookie || !name) return null;
  const rawCookie = String(req.headers.cookie);
  const parts = rawCookie.split(';');
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i].trim();
    const eq = item.indexOf('=');
    if (eq > 0 && item.slice(0, eq).trim() === name) {
      const rawVal = item.slice(eq + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

function getSessionToken(req) {
  if (!req || !req.headers) return null;
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return match[1].trim();
  }
  const xToken = req.headers['x-session-token'];
  if (xToken && typeof xToken === 'string' && xToken.trim()) {
    return xToken.trim();
  }
  return getCookie(req, 'westo_session');
}

function currentUser(req) {
  const token = getSessionToken(req);
  const tenantId = normalizeTenantId(
    req?.tenantId || req?.tenant?.tenantSlug || req?.tenant?.tenantId || db.tenantIdentity?.tenantId || TENANT_CONFIG.tenantId,
  );
  const data = parseToken(token, tenantId);
  if (!data || !Number.isFinite(Number(data.ts)) || Date.now() - Number(data.ts) > SESSION_TTL_MS) return null;
  const user = db.users.find((u) => u.phone === data.phone);
  if (!user || user.blocked || isPlatformOnlyIdentity(user)) return null;
  return user;
}
function effectiveRole(user) {
  if (isPlatformOnlyIdentity(user)) return 'guest';
  const adminPhones = Array.isArray(db.settings?.adminPhones) ? db.settings.adminPhones : [];
  return normalizeRole(user?.role, adminPhones, user?.phone || '');
}
function userCan(user, capability) {
  if (isPlatformOnlyIdentity(user)) return false;
  const adminPhones = Array.isArray(db.settings?.adminPhones) ? db.settings.adminPhones : [];
  const settings = { ...(db.settings || {}), adminPhones };
  return !!user && hasCapability(user, capability, settings);
}
function operationalOrderResponse(order, user) {
  return operationalOrderDto(order, {
    includePii: userCan(user, 'pii.view'),
    includePaymentReferences: userCan(user, 'payments.manage'),
    includeDeliveryReason: userCan(user, 'delivery.manage'),
  });
}
function operationalPaymentResponse(payment, user) {
  return adminPaymentDto(payment, {
    includePaymentReferences: userCan(user, 'payments.manage'),
  });
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}
function requireCapability(capability) {
  return (req, res, next) => {
    const user = currentUser(req);
    const declared = Array.isArray(capability) ? capability : [capability];
    const routeCapability = declared.length === 1 && declared[0] === 'admin.access'
      ? lookupCapability(req.method, req.path)
      : null;
    const required = routeCapability ? [routeCapability] : declared;
    const allowed = required.some((cap) => userCan(user, cap));
    if (!allowed) {
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      return res.status(403).json({ error: 'forbidden', capability });
    }
    req.user = user;
    try {
      assertRequestBranchAccess(req);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }

    // Preserve the legacy guard's OR semantics while applying the shared
    // Control Plane policy after WESTO has resolved its authenticated user.
    // The global route-aware layer may already have evaluated the same single
    // capability; skip only that exact duplicate decision.
    if (required.length === 1 && req.neemShadowPolicy?.permissionKey === required[0]) return next();
    const policyMiddleware = required.length === 1
      ? requireCapabilityEnforced(required[0])
      : requireAnyCapabilityEnforced(required);
    return policyMiddleware(req, res, next);
  };
}
function assertUserBranchAccess(user, branchId) {
  const allowedBranchIds = branchScopeForUser(user, { role: effectiveRole(user) });
  if (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branchId))) {
    throw branchScopeError('branch_access_denied', 403, 'دسترسی به شعبهٔ این سفارش مجاز نیست.');
  }
}
function requireAdmin(req, res, next) {
  const routeCapability = lookupPolicyCapability(req.method, req.path);
  return requireCapability(routeCapability || 'admin.access')(req, res, next);
}
function requireCommandCenterAccess(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!userCan(user, 'ops.view') && !userCan(user, 'command.view') && !userCan(user, 'kitchen.view') && !userCan(user, 'admin.access')) {
    return res.status(403).json({ error: 'command_center_forbidden' });
  }
  req.user = user;
  try {
    assertRequestBranchAccess(req);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const routeCapability = lookupPolicyCapability(req.method, req.path) || 'command.view';
  return requireCapability(routeCapability)(req, res, next);
}
function requireKitchen(req, res, next) {
  return requireCapability('kitchen.view')(req, res, next);
}
function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (effectiveRole(user) !== 'owner') return res.status(403).json({ error: 'owner_required' });
  req.user = user;
  next();
}
function isBirthdateLocked(u) {
  if (!u || !u.birthdate) return false;
  if (!u.birthdateUpdatedAt) return true; // If birthdate is already set, lock by default until 1 year passes
  const elapsedMs = Date.now() - new Date(u.birthdateUpdatedAt).getTime();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  return elapsedMs < oneYearMs;
}

function publicUser(u) {
  const role = effectiveRole(u);
  const allowedBranchIds = branchScopeForUser(u, { role });
  const addresses = Array.isArray(u.addresses) ? u.addresses : (u.address ? [{
    id: 'addr_default',
    title: '🏠 منزل',
    city: u.city || '',
    district: '',
    address: u.address,
    plaque: '',
    unit: '',
    floor: '',
    receiverName: u.name || '',
    receiverPhone: u.phone || '',
    note: u.notes || '',
    isDefault: true,
    createdAt: u.createdAt || new Date().toISOString(),
  }] : []);

  return {
    phone: u.phone,
    name: u.name || '',
    email: u.email || '',
    role,
    roleLabel: roleLabel(role),
    capabilities: capabilitiesFor(u, db.settings || {}),
    allowedBranchIds,
    points: Math.max(0, Math.round(Number(u.points) || 0)),
    birthdate: u.birthdate || '',
    birthdateLocked: isBirthdateLocked(u),
    birthdateUpdatedAt: u.birthdateUpdatedAt || null,
    gender: u.gender || '',
    city: u.city || '',
    address: u.address || '',
    addresses,
    defaultAddress: addresses.find((a) => a.isDefault) || addresses[0] || null,
    avatar: u.avatar || '',
    preferences: Array.isArray(u.preferences) ? u.preferences : [],
    tags: Array.isArray(u.tags) ? u.tags : [],
    vipNote: u.vipNote || '',
    notes: u.notes || '',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    blocked: !!u.blocked,
  };
}

function publishOperationalEvent(type, payload = {}, permission = 'ops.view') {
  db.commandCenter = db.commandCenter || { schemaVersion: 1, eventRevision: 0 };
  db.commandCenter.eventRevision = Number(db.commandCenter.eventRevision || 0) + 1;
  eventHub.publish(type, { ...payload, revision: db.commandCenter.eventRevision }, permission);
}

function recordAudit(req, action, targetType, targetId, meta = {}, branchId = null, options = {}) {
  if (req) req.auditRecorded = true;
  const entry = createAuditEntry({
    actor: req?.user || null,
    action,
    targetType,
    targetId,
    branchId,
    meta,
  });
  entry.tenantId = resolveAuditTenantId(req, tenantStorage.getStore()?.tenantId, TENANT_CONFIG.tenantId);
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift(entry);
  db.auditLog = db.auditLog.slice(0, 5000);
  if (stateStore.enabled && options.deferAppend !== true) {
    stateStore.appendAudit(entry).catch((error) => console.error('[postgres] unable to append audit event', error.message));
  }
  return entry;
}

function appendAuditAfterCommit(entry) {
  if (!entry || !stateStore.enabled) return;
  stateStore.appendAudit(entry).catch((error) => console.error('[postgres] unable to append audit event', error.message));
}

function awardLoyaltyPoints(phone, points, reason, meta = {}) {
  if (!db.loyalty?.enabled) return null;
  const pts = Math.round(Number(points) || 0);
  if (!pts || !phone) return null;
  let user = db.users.find((u) => u.phone === phone);
  if (!user) {
    user = {
      phone,
      name: '',
      email: '',
      role: 'user',
      points: 0,
      createdAt: new Date().toISOString(),
      blocked: false,
    };
    db.users.push(user);
  }
  if (typeof user.points !== 'number') user.points = 0;
  user.points = Math.max(0, user.points + pts);
  const entry = {
    id: Math.max(0, ...(db.loyaltyLedger || []).map((e) => e.id), 0) + 1,
    phone,
    delta: pts,
    balance: user.points,
    reason: String(reason || 'adjust').slice(0, 80),
    meta,
    at: new Date().toISOString(),
  };
  db.loyaltyLedger = db.loyaltyLedger || [];
  db.loyaltyLedger.unshift(entry);
  db.loyaltyLedger = db.loyaltyLedger.slice(0, 2000);
  return entry;
}

function pointsForOrderTotal(total, phone) {
  const user = phone ? db.users.find((u) => u.phone === phone) : null;
  const resolved = loyaltyEngine.resolveCustomerTier(db, user);
  return loyaltyEngine.calculateOrderPointsEarned(db, total, resolved.tier);
}

// ---- OTP & Cybersecurity Hardening ------------------------------------
const otps = new Map(); // phone -> { code, expiresAt, attempts, requestedAt }
const otpRequestTimestamps = new Map(); // phone -> lastRequestedEpochMs
const OTP_COOLDOWN_MS = Number(process.env.OTP_COOLDOWN_MS) || 0; // [TEMPORARILY 0 FOR DEV] was 60000
const MAX_OTP_ATTEMPTS = 5;
const PHONE_RE = /^09\d{9}$/;

// Accept Persian (۰-۹) and Arabic (٠-٩) digits everywhere numbers come in.
function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function normalizePhoneKey(phone) {
  if (!phone) return '';
  let digits = normalizeDigits(String(phone)).replace(/\D/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function phonesMatch(p1, p2) {
  const k1 = normalizePhoneKey(p1);
  const k2 = normalizePhoneKey(p2);
  return !!(k1 && k2 && k1 === k2);
}

// Public order mutations remain intentionally handler-controlled because they
// are customer flows, not staff capabilities. They still need production
// gates of their own: replay protection, abuse throttling and a commercial
// entitlement that is authoritative outside the WESTO JSON snapshot.
const PUBLIC_ORDER_RATE_WINDOW_MS = 60 * 1000;
const PUBLIC_ORDER_RATE_LIMIT = 30;
const PUBLIC_CHECKOUT_RECOVERY_RATE_LIMIT = 10;
const ORDER_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const publicOrderRateBuckets = new Map();
const publicCheckoutRecoveryRateBuckets = new Map();

function normalizeCheckoutReceiptCode(value) {
  const compact = String(value || '').trim().replace(/[\s-]/g, '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(compact) ? compact : '';
}

function checkoutReceiptIndexKey(value) {
  const code = normalizeCheckoutReceiptCode(value);
  if (!code) return '';
  return crypto.createHmac('sha256', SECRET)
    .update(`westo:guest-checkout-receipt:v1:${code}`)
    .digest('hex');
}

function publicMutationClientKey(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return ip || 'unknown';
}

function hasActiveLocalEntitlement(featureKey) {
  const entitlements = db.neemEntitlements || db.featureEntitlements || null;
  const raw = entitlements && entitlements[featureKey];
  if (raw === true) return true;
  if (!raw || raw.active === false) return false;
  if (raw.active !== true && !['active', 'trialing', 'provisioning'].includes(String(raw.status || '').toLowerCase())) return false;
  if (raw.expiresAt && new Date(raw.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function productionPaymentProviderReady() {
  const configuredMode = String(db.paymentProvider?.mode || 'sandbox').trim().toLowerCase();
  const configuredProvider = String(db.paymentProvider?.provider || 'sandbox').trim().toLowerCase();
  if (db.paymentProvider?.enabled === false || configuredMode === 'disabled') return false;
  if (process.env.NODE_ENV !== 'production') {
    // This checkout implements only its local sandbox flow. A configured live
    // provider is not usable until a real create-and-verify adapter exists.
    return configuredMode === 'sandbox' && configuredProvider === 'sandbox';
  }
  // A provider name/mode in the local settings is not evidence that a real
  // order-payment adapter can create and verify a bank transaction. Keep the
  // production path closed until a provider adapter is wired and verified.
  return false;
}

function guardPublicOrderMutation(req, res, featureKey) {
  const now = Date.now();
  const key = publicMutationClientKey(req);
  const existing = publicOrderRateBuckets.get(key);
  const bucket = existing && now - existing.startedAt < PUBLIC_ORDER_RATE_WINDOW_MS
    ? existing
    : { startedAt: now, count: 0 };
  bucket.count += 1;
  publicOrderRateBuckets.set(key, bucket);
  if (publicOrderRateBuckets.size > 5000) {
    for (const [clientKey, candidate] of publicOrderRateBuckets) {
      if (now - candidate.startedAt >= PUBLIC_ORDER_RATE_WINDOW_MS) publicOrderRateBuckets.delete(clientKey);
    }
  }
  if (bucket.count > PUBLIC_ORDER_RATE_LIMIT) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'public_order_rate_limited', retryAfterSec: 60 });
    return false;
  }

  if (process.env.NODE_ENV !== 'production') return true;
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (!ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    res.status(400).json({ error: 'idempotency_key_required', message: 'برای ثبت سفارش تولیدی، Idempotency-Key معتبر الزامی است.' });
    return false;
  }
  if (!hasActiveLocalEntitlement(featureKey)) {
    res.status(503).json({ error: 'feature_entitlement_unavailable', featureKey, message: 'حق استفادهٔ تجاری این مسیر از Control Plane تأیید نشده است.' });
    return false;
  }
  return true;
}

function guardPublicCheckoutRecovery(req, res, next) {
  const now = Date.now();
  const key = publicMutationClientKey(req);
  const existing = publicCheckoutRecoveryRateBuckets.get(key);
  const bucket = existing && now - existing.startedAt < PUBLIC_ORDER_RATE_WINDOW_MS
    ? existing
    : { startedAt: now, count: 0 };
  bucket.count += 1;
  publicCheckoutRecoveryRateBuckets.set(key, bucket);
  if (publicCheckoutRecoveryRateBuckets.size > 5000) {
    for (const [clientKey, candidate] of publicCheckoutRecoveryRateBuckets) {
      if (now - candidate.startedAt >= PUBLIC_ORDER_RATE_WINDOW_MS) publicCheckoutRecoveryRateBuckets.delete(clientKey);
    }
  }
  if (bucket.count > PUBLIC_CHECKOUT_RECOVERY_RATE_LIMIT) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'public_order_rate_limited', retryAfterSec: 60 });
  }
  return next();
}

function publicOrderMutationGuard(featureKey) {
  return (req, res, next) => {
    if (!guardPublicOrderMutation(req, res, featureKey)) return;
    next();
  };
}

function sandboxPaymentGuard(req, res, next) {
  if (process.env.NODE_ENV === 'production') return res.status(409).json({ error: 'sandbox_disabled' });
  next();
}

// ---- app ----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
const fixedTenantHostMiddleware = tenantHostMiddleware(TENANT_CONFIG, { logger: console });
app.use((req, res, next) => {
  if (!TENANT_INFRASTRUCTURE_ENABLED) {
    return fixedTenantHostMiddleware(req, res, () => {
      const tenantId = normalizeTenantId(req.tenant?.tenantSlug || req.tenant?.tenantId);
      const persistenceError = legacyTenantPersistenceError({ tenantId });
      if (persistenceError) {
        return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
      }
      const tenantDb = tenantRegistry.getTenantDb(tenantId);
      if (!tenantId || !tenantDb) {
        return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
      }
      const context = createTenantContext({
        tenantId,
        tenantSlug: tenantId,
        domain: req.headers.host,
        databaseName: `tenant_${tenantId.replace(/-/g, '_')}`,
        databaseProvider: 'legacy-json',
        cellId: TENANT_CONFIG.cellId,
        release: TENANT_CONFIG.release,
        source: 'fixed-local-tenant',
        moduleVersions: tenantDb.tenantIdentity?.moduleVersions || {},
      });
      req.tenantContext = context;
      req.tenantId = context.tenantId;
      req.tenantSlug = context.tenantSlug;
      req.tenantDb = tenantDb;
      req.tenantDataAccess = null;
      return tenantStorage.run({ ...context, db: tenantDb, tenantDataAccess: null }, next);
    });
  }

  // New boundary mode is fail-closed: no Control DB means no tenant request.
  const controlAccess = runtimeControlDataAccess || tenantResolver.controlDataAccess;
  if (!controlAccess) {
    return res.status(503).json({
      ok: false,
      error: 'tenant_control_database_unavailable',
      message: 'Control DB برای تشخیص tenant تنظیم نشده است.',
    });
  }

  return tenantResolver.middleware()(req, res, () => {
    const context = req.tenantContext;
    const persistenceError = legacyTenantPersistenceError({ tenantId: context?.tenantId });
    if (persistenceError) {
      return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
    }
    let legacyDb = tenantRegistry.getTenantDb(context.tenantId);
    if (!legacyDb) {
      legacyDb = tenantRegistry.provisionTenant(context.tenantId, {
        name: context.tenantSlug,
        domain: context.domain,
        cellId: context.cellId,
      });
    }
    const tenantDb = legacyDb;
    req.tenant = {
      ...TENANT_CONFIG,
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
      canonicalDomain: context.domain || TENANT_CONFIG.canonicalDomain,
      cellId: context.cellId || TENANT_CONFIG.cellId,
      release: context.release || TENANT_CONFIG.release,
    };
    req.tenantId = context.tenantId;
    req.tenantSlug = context.tenantSlug;
    req.tenantDb = tenantDb;
    req.tenantDataAccess = tenantConnectionManager.forContext(context);
    return tenantStorage.run({
      ...context,
      db: tenantDb,
      tenantDataAccess: req.tenantDataAccess,
      controlDataAccess: controlAccess,
    }, next);
  });
});
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const readiness = settlementPersistenceGate.check({
    postgresEnabled: stateStore.enabled,
    postgresRequired: stateStore.required,
  });
  if (readiness.ok) return next();
  return res.status(readiness.status).json({
    ok: false,
    error: readiness.code,
    message: readiness.message,
    persistenceError: settlementPersistenceGate.uncertainty()?.code,
  });
});
// ── SALSA Tenant Policy Enforcement Layer ───────────────────────────────────
// Attaches req.salsaPrincipal & req.neemPrincipal on every request (non-blocking).
// Resolve WESTO's signed session before the route-aware policy layer so an
// authenticated operator is not evaluated as the anonymous guest.
app.use(createSalsaPrincipalMiddleware({ resolveUser: currentUser }));
// Shadow-evaluates (or enforces, depending on SALSA_POLICY_MODE / NEEM_POLICY_MODE) policy for
// all routes listed in the route-capability-map. In shadow mode this never
// blocks; in enforce mode it returns 403 on DENY.
app.use(salsaRouteAwarePolicyMiddleware());
// SALSA God Mode dynamic feature entitlement gate
app.use((req, res, next) => {
  const isFinance = req.path.startsWith('/api/admin/finance') || req.path.startsWith('/api/admin/v2/finance');
  if (isFinance) {
    const entitlements = db.salsaEntitlements || db.featureEntitlements || db.neemEntitlements;
    const financeGrant = entitlements && entitlements['finance.workspace'];
    if (financeGrant && (financeGrant.active === false || financeGrant.status === 'disabled')) {
      return res.status(403).json({
        ok: false,
        error: 'feature_disabled',
        featureKey: 'finance.workspace',
        message: 'بخش حسابداری و امور مالی توسط کنترل‌پلن SALSA برای این مشتری غیرفعال شده است.'
      });
    }
  }

  // Universal route-to-feature mapping for all 12 operational domains
  const featureKey = resolveFeatureForRoute(req.path, req.method);
  if (featureKey) {
    const isEnabled = isFeatureEnabledForTenant(db, featureKey);
    if (!isEnabled) {
      const info = getFeatureInfo(featureKey);
      return res.status(403).json({
        ok: false,
        error: 'feature_disabled',
        featureKey,
        message: `قابلیت «${info.nameFa || featureKey}» توسط کنترل‌پلن SALSA برای این مشتری غیرفعال شده است.`
      });
    }
  }

  next();
});
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use((req, res, next) => {
  const json = res.json;
  res.json = function(payload) { return json.call(this, withoutUnsubscribedFinance(db, payload)); };
  next();
});
app.use(compression({ threshold: 1024, level: 6 }));
app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 96);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  if (/^\/api\/(?:admin|auth|kitchen)\b/.test(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use((error, req, res, next) => {
  if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
    return res.status(400).json({ error: 'invalid_json', requestId: req.requestId });
  }
  return next(error);
});
function sanitizePrototypeKeys(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete obj[key];
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizePrototypeKeys(obj[key], seen);
    }
  }
}
app.use((req, res, next) => {
  if (req.body) sanitizePrototypeKeys(req.body);
  if (req.query) sanitizePrototypeKeys(req.query);
  if (req.params) sanitizePrototypeKeys(req.params);
  next();
});
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  const origin = String(req.headers.origin || '');
  const hasSessionCookie = Boolean(getCookie(req, 'westo_session'));
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (hasSessionCookie && !origin) {
    return res.status(403).json({ error: 'same_origin_required', requestId: req.requestId });
  }
  if (hasSessionCookie && fetchSite === 'cross-site') {
    return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId });
  }
  if (!origin) return next(); // server-to-server integrations and non-cookie clients
  let originHost = '';
  try { originHost = new URL(origin).host; } catch (_) { return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId }); }
  if (originHost !== String(req.get('host') || '')) {
    const isNeemGodMode = (req.path.startsWith('/api/admin/features') || req.path.startsWith('/api/admin/tenants')) && (originHost.includes(':3050') || originHost.includes(':3061'));
    if (!isNeemGodMode) {
      return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId });
    }
  }
  next();
});

// Sensitive operational writes that predate the command-center endpoints are
// recorded automatically. Newer routes record richer, domain-specific entries
// themselves; `auditRecorded` prevents a duplicate generic event.
app.use((req, res, next) => {
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isSensitivePath = /^(?:\/api\/admin\/|\/api\/kitchen\/|\/api\/content$|\/api\/menu\/|\/api\/faq(?:-|$))/.test(req.path);
  if (!isWrite || !isSensitivePath) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || req.auditRecorded) return;
    const actor = req.user || currentUser(req);
    if (!actor) return;
    const target = req.path.replace(/^\/api\//, '').replace(/\//g, ':').slice(0, 180);
    const action = `mutation.${req.method.toLowerCase()}`;
    const branchId = Number(req.body?.branchId || req.query?.branchId) || null;
    recordAudit(req, action, 'api_route', target, { path: req.path }, branchId);
    publishOperationalEvent('admin.updated', { path: req.path, branchId }, 'command.view');
    save();
  });
  next();
});

function branchScoped(list, branchId) {
  if (!branchId) return list;
  return list.filter((item) => Number(item.branchId) === Number(branchId));
}

function commandCenterPayload(branchId = null) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const orders = branchScoped(db.orders || [], branchId);
  const reservations = branchScoped(db.reservations || [], branchId);
  const paymentAttempts = branchScoped(db.paymentAttempts || [], branchId);
  const tables = branchScoped(db.tables || [], branchId);
  const activeStatuses = new Set([
    'pending_online',
    'awaiting_confirmation',
    'pay_at_cashier',
    'sent_to_kitchen',
    'paid',
    'preparing',
    'ready',
    'dispatched',
  ]);
  const queue = orders
    .filter((order) => activeStatuses.has(order.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, 32)
    .map((order) => ({
      ...getOrderAging(order, now),
      id: order.id,
      branchId: order.branchId,
      status: order.status,
      paymentStatus: paymentStatusFor(order),
      fulfillment: normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }),
      tableNo: order.tableNo || null,
      customerName: order.name || 'مهمان',
      total: order.total,
      createdAt: order.createdAt,
      items: (order.items || []).map((line) => ({ name: line.name, qty: line.qty })),
    }));
  const legacyLowStock = (db.menuItems || [])
    .filter((item) => !financeV2.menuItemUsesInventoryV2(db, item.id, branchId)
      && typeof item.stock === 'number' && item.stock <= Math.max(0, Number(item.lowStockAt) || 5))
    .map((item) => ({ id: item.id, name: item.name, stock: item.stock, lowStockAt: item.lowStockAt, kind: 'menu' }));
  const materialLowStock = financeV2.inventoryItemsView(db, { branchId }).items
    .filter((item) => Number(item.minStock || 0) > 0
      && Number(item.availableQuantity ?? item.qtyOnHand ?? item.onHand ?? item.quantity) <= Number(item.minStock))
    .map((item) => ({
      id: item.id, name: item.name, stock: Number(item.availableQuantity ?? item.qtyOnHand ?? item.onHand ?? item.quantity) || 0,
      lowStockAt: Number(item.minStock) || 0, unit: item.unit || null, kind: 'material',
    }));
  const lowStock = [...materialLowStock, ...legacyLowStock].slice(0, 12);
  const activeReservations = reservations.filter((item) => item.date === today && !['cancelled', 'no_show'].includes(item.status));
  const tableCapacity = tables.reduce((sum, table) => sum + (Number(table.seats) || 0), 0);
  const usedCapacity = activeReservations.reduce((sum, item) => sum + (Number(item.partySize) || 0), 0);
  const delayed = queue.filter((item) => item.attentionType === 'kitchen');
  const paymentAttention = queue.filter((item) => item.attentionType === 'payment');
  const handoffAttention = queue.filter((item) => item.attentionType === 'handoff');
  const kitchenQueue = queue.filter((item) => ['sent_to_kitchen', 'paid', 'preparing'].includes(item.status)).length;
  return {
    generatedAt: new Date().toISOString(),
    revision: Number(db.commandCenter?.eventRevision || 0),
    branchId: branchId || null,
    summary: {
      queue: queue.length,
      delayed: delayed.length,
      kitchenQueue,
      paymentAttention: paymentAttention.length,
      handoffAttention: handoffAttention.length,
      lowStock: lowStock.length,
      reservationsToday: activeReservations.length,
      pendingPayments: paymentAttempts.filter((item) => item.status === 'pending').length + queue.filter((item) => item.paymentStatus === 'pending').length,
      capacity: { used: usedCapacity, total: tableCapacity, percent: tableCapacity ? Math.round((usedCapacity / tableCapacity) * 100) : 0 },
    },
    queue,
    delayed,
    paymentAttention,
    handoffAttention,
    lowStock,
    reservations: activeReservations.slice(0, 12),
    payments: paymentAttempts.filter((item) => ['pending', 'failed'].includes(item.status)).slice(0, 12),
    audit: (db.auditLog || []).slice(0, 12),
  };
}

moduleRuntime.registerHttpRoute('platform_core', 'get-001', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-002', moduleRouteContext);

const STAFF_WORKSPACES = Object.freeze({
  cashier: { label: 'صندوق', path: '/admin/cashier', capability: 'cash.manage' },
  waiter: { label: 'سالن و گارسون', path: '/admin/waiter', capability: 'service.manage' },
  kitchen: { label: 'آشپزخانه', path: '/admin/kitchen', capability: 'kitchen.view' },
});

function canOpenWorkspace(user, workspace) {
  const target = STAFF_WORKSPACES[workspace];
  if (!target) return false;
  const role = effectiveRole(user);
  return role === workspace || role === 'owner' || role === 'manager';
}

function activeStaffShift(user, branchId) {
  return (db.staffShifts || []).find((shift) =>
    shift.phone === user.phone && Number(shift.branchId) === Number(branchId) && !shift.closedAt
  ) || null;
}

function activeCashSession(user, branchId) {
  return (db.cashSessions || []).find((session) =>
    session.phone === user.phone && Number(session.branchId) === Number(branchId) && !session.closedAt
  ) || null;
}

function cashSessionTotals(session) {
  const opening = parseCashDrawerAmount(session?.openingAmount, { allowZero: true });
  if (opening == null) return null;
  const movements = session?.movements === undefined ? [] : session.movements;
  if (!Array.isArray(movements)) return null;
  let signed = 0;
  let sales = 0;
  let payIn = 0;
  let payOut = 0;
  let refunds = 0;
  const addSafe = (current, amount) => {
    const next = current + amount;
    return Number.isSafeInteger(next) ? next : null;
  };
  for (const movement of movements) {
    if (!movement || typeof movement !== 'object' || Array.isArray(movement)) return null;
    const rawAmount = movement.amount;
    const normalized = typeof rawAmount === 'string' ? normalizeDigits(rawAmount).trim() : rawAmount;
    if ((typeof normalized !== 'number' && (typeof normalized !== 'string' || !/^[+-]?\d+$/u.test(normalized)))
      || !Number.isSafeInteger(Number(normalized)) || Number(normalized) === 0) return null;
    const amount = Number(normalized);
    signed = addSafe(signed, amount);
    if (signed == null) return null;
    if (movement.type === 'sale') {
      if (amount < 0) return null;
      sales = addSafe(sales, amount);
      if (sales == null) return null;
    } else if (movement.type === 'pay_in') {
      if (amount < 0) return null;
      payIn = addSafe(payIn, amount);
      if (payIn == null) return null;
    } else if (movement.type === 'pay_out') {
      if (amount > 0) return null;
      payOut = addSafe(payOut, Math.abs(amount));
      if (payOut == null) return null;
    } else if (movement.type === 'refund') {
      refunds = addSafe(refunds, Math.abs(amount));
      if (refunds == null) return null;
    }
  }
  const expected = addSafe(opening, signed);
  if (expected == null) return null;
  return {
    opening,
    sales,
    payIn,
    payOut,
    refunds,
    expected,
  };
}

moduleRuntime.registerHttpRoute('platform_core', 'get-003', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-004', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-005', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-006', moduleRouteContext);

// Cash drawer inputs are whole Toman amounts. Reject malformed values instead
// of silently coercing them to zero, and keep retries tied to a durable key.
function parseCashDrawerAmount(value, { allowZero = false } = {}) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) ? value : null;
  }
  const normalized = normalizeDigits(String(value ?? '').trim());
  if (!normalized || !/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(normalized)) return null;
  const amount = Number(normalized.replace(/[٬,]/g, ''));
  return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) ? amount : null;
}

function normalizeCashDrawerIdempotencyKey(headerValue, bodyValue) {
  const header = String(headerValue || '').trim();
  const body = String(bodyValue || '').trim();
  if (header && body && header !== body) return { error: 'cash_movement_idempotency_invalid' };
  const key = header || body;
  if (!key) return { error: 'cash_movement_idempotency_required' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(key)) return { error: 'cash_movement_idempotency_invalid' };
  return { key };
}

function cashDrawerMovementFingerprint({ tenantId, branchId, sessionId, phone, type, amount, note }) {
  const request = JSON.stringify({
    tenantId: String(tenantId || ''), branchId: Number(branchId), sessionId: String(sessionId),
    phone: String(phone || ''), type: String(type), amount: Number(amount), note: String(note || ''),
  });
  return crypto.createHash('sha256').update(request).digest('hex');
}

function cashDrawerOpenRetry(session, openingAmount) {
  if (!session) return { kind: 'new' };
  return Number.isSafeInteger(Number(session.openingAmount))
    && Number(session.openingAmount) === Number(openingAmount)
    ? { kind: 'duplicate', session }
    : { kind: 'conflict', session };
}

function findCashDrawerMovementRetry(session, key, fingerprint) {
  const movement = (Array.isArray(session?.movements) ? session.movements : [])
    .find((item) => item?.idempotencyKey === key);
  if (!movement) return { kind: 'new' };
  return movement.requestFingerprint === fingerprint
    ? { kind: 'duplicate', movement }
    : { kind: 'conflict', movement };
}

function cashDrawerPayOutExceedsAvailable(totals, amount) {
  return !Number.isSafeInteger(totals?.expected)
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || amount > totals.expected;
}

const cashDrawerMutationQueues = new Map();
function cashDrawerMutationQueueKey(req, branchId) {
  const tenantId = String(req?.tenantId || '').trim();
  const branch = Number(branchId);
  const phone = String(req?.user?.phone || '').trim();
  if (!tenantId || !Number.isSafeInteger(branch) || branch <= 0 || !phone) {
    throw Object.assign(new Error('Cash drawer mutation identity is invalid.'), {
      code: 'cash_drawer_lock_identity_invalid', status: 409,
    });
  }
  return `${tenantId}:${branch}:${phone}`;
}

async function withCashDrawerMutationLock(key, task) {
  const previous = cashDrawerMutationQueues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  cashDrawerMutationQueues.set(key, current);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (cashDrawerMutationQueues.get(key) === current) cashDrawerMutationQueues.delete(key);
  }
}

async function withCashDrawerSettlementLock(req, orderId, operation) {
  const tender = String(req?.body?.tender || 'cash');
  const order = (db.orders || []).find((item) => Number(item.id) === Number(orderId));
  const branchId = persistedOrderBranchId(order);
  if (!order || branchId == null || tender !== 'cash') return operation();
  return withCashDrawerMutationLock(cashDrawerMutationQueueKey(req, branchId), operation);
}

moduleRuntime.registerHttpRoute('pos', 'get-007', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-008', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-009', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-010', moduleRouteContext);

registerAdminV2Routes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  requireAdmin,
  parseBranchId,
  requestBranchValue,
  effectiveRole,
  normalizeDigits,
  phoneRe: PHONE_RE,
  recordAudit,
  appendAudit: appendAuditAfterCommit,
});

financeV2.registerFinanceV2Routes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  effectiveRole,
  getStorageStatus: () => stateStore.financeStatus(),
});

// Finance V1 remains a read-only compatibility adapter during the shadow
// ledger rollout. All new mutations must use the idempotent Finance V2 API.
app.use('/api/admin/finance', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/vendors' || req.path.startsWith('/vendors/')) return next();
  return res.status(410).json({
    data: null,
    meta: { generatedAt: new Date().toISOString(), replacement: '/api/admin/v2/finance' },
    error: { code: 'finance_v1_read_only', message: 'عملیات نوشتنی مالی به Finance V2 منتقل شده است.' },
  });
});

// The remaining /v1 and taxpayer write aliases are legacy compatibility
// surfaces too. Keep their read routes available, but fail closed before any
// old accounting engine can create a parallel ledger outside Finance V2.
const blockLegacyFinanceWrites = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.baseUrl === '/v1' && req.path === '/audit/validate-permission') return next();
  return res.status(410).json({
    data: null,
    meta: { generatedAt: new Date().toISOString(), replacement: '/api/admin/v2/finance' },
    error: { code: 'finance_v1_read_only', message: 'عملیات نوشتنی مالی به Finance V2 منتقل شده است.' },
  });
};
app.use('/v1', blockLegacyFinanceWrites);
app.use('/api/tax', blockLegacyFinanceWrites);

registerAccountingRoutes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  requireAdmin,
  parseBranchId,
});

moduleRuntime.registerHttpRoute('platform_core', 'get-011', moduleRouteContext);

// SALSA remains a separate operations application so its React runtime and
// finance database can never interfere with the public 3D menu runtime.
const handleIntegrationStatus = (req, res) => {
  res.json({ ok: true, integration: salsaBridge.status() });
};
const handleIntegrationRetry = (req, res) => {
  salsaBridge.retry();
  res.json({ ok: true, integration: salsaBridge.status() });
};
const handleIntegrationBackfill = (req, res) => {
  const queued = salsaBridge.queueBackfill();
  res.json({ ok: true, queued, integration: salsaBridge.status() });
};

app.use((req, res, next) => {
  if (req.url && req.url.startsWith('/api/admin/salsa-integration')) {
    req.url = req.url.replace('/api/admin/salsa-integration', '/api/admin/neem-integration');
  }
  next();
});

moduleRuntime.registerHttpRoute('platform_core', 'get-012', moduleRouteContext);
moduleRuntime.registerHttpRoute('platform_core', 'post-013', moduleRouteContext);
moduleRuntime.registerHttpRoute('platform_core', 'post-014', moduleRouteContext);

// Dynamic Feature Control from SALSA God Mode & Health Check
app.use((req, res, next) => {
  if (req.path === '/api/ready' && ['GET', 'HEAD'].includes(req.method)) {
    void (async () => {
      const databasePing = await stateStore.ping();
      const readiness = runtimeReadiness({
        nodeEnv: process.env.NODE_ENV,
        postgresEnabled: stateStore.enabled,
        postgresRequired: stateStore.required,
        databasePing,
        financeStatus: stateStore.financeStatus(),
        settlementGate: settlementPersistenceGate.check({
          postgresEnabled: stateStore.enabled,
          postgresRequired: stateStore.required,
        }),
      });
      return res.status(readiness.ok ? 200 : 503).json({
        ...readiness,
        app: 'WESTO',
        version: '1.2.0',
        timestamp: new Date().toISOString(),
      });
    })().catch(next);
    return;
  }

  if (req.path === '/api/health') {
    const origin = String(req.headers.origin || '');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return res.json({
      ok: true,
      status: 'healthy',
      app: 'WESTO',
      version: '1.2.0',
      port: PORT,
      database: stateStore.enabled ? 'postgresql-configured' : 'memory-fallback',
      timestamp: new Date().toISOString()
    });
  }

  const applyAdminCors = () => {
    const origin = String(req.headers.origin || '');
    if (origin && (origin.includes(':3050') || origin.includes(':3061') || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, Authorization, X-Salsa-Control-Secret, X-Neem-Control-Secret, X-Tenant-Id, X-Tenant-Slug');
    }
  };

  if (req.path === '/api/admin/live-summary' && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.sendStatus(204);
  }

  if (req.path === '/api/admin/live-summary' && req.method === 'GET') {
    applyAdminCors();
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    if (!hasBridgeCredential && !isTrustedLocalControlPlaneOrigin(req)) {
      return res.status(401).json({ ok: false, error: 'control_plane_bridge_required' });
    }
    const requestTenant = normalizeTenantId(req.tenantContext?.tenantId || req.tenantSlug || TENANT_CONFIG.tenantId);
    const targetTenant = normalizeTenantId(req.query.tenantId || requestTenant);
    if (!targetTenant) return res.status(400).json({ ok: false, error: 'tenant_id_invalid' });
    if (targetTenant !== requestTenant && !hasBridgeCredential && !isTrustedLocalControlPlaneOrigin(req)) {
      return res.status(403).json({ ok: false, error: 'tenant_scope_denied' });
    }
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb) {
      return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
    }
    const orders = Array.isArray(targetDb.orders) ? targetDb.orders : [];
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const users = (Array.isArray(targetDb.users) ? targetDb.users : []).map(u => ({
      id: u.id,
      name: u.name || 'پرسنل مجموعه',
      phone: u.phone || '',
      role: u.role || 'staff',
      active: u.active !== false
    }));
    return res.json({
      ok: true,
      tenantId: targetTenant,
      name: targetDb.restaurant?.name || 'کافه رستوران وستو',
      status: 'active',
      menuItemsCount: (targetDb.menuItems || []).length,
      categoriesCount: (targetDb.menuCategories || []).length,
      ordersCount: orders.length,
      tablesCount: (targetDb.tables || []).length,
      branchesCount: (targetDb.branches || []).length || 1,
      usersCount: users.length,
      users,
      totalRevenue,
      devicesCount: 4,
      features: targetDb.featureEntitlements || {},
      printers: targetDb.settings?.printers || [],
      lastBackup: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });
  }

  if ((req.path === '/api/admin/features' || req.path === '/api/features' || req.path === '/api/admin/features/current') && req.method === 'GET') {
    applyAdminCors();
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    const localControlPlane = isTrustedLocalControlPlaneOrigin(req);
    const requestTenant = normalizeTenantId(req.tenantContext?.tenantId || req.tenantSlug || TENANT_CONFIG.tenantId);
    const targetTenant = normalizeTenantId(req.query.tenantId || requestTenant);
    if (!targetTenant) return res.status(400).json({ ok: false, error: 'tenant_id_invalid' });
    if (targetTenant !== requestTenant && !hasBridgeCredential && !localControlPlane) {
      return res.status(403).json({ ok: false, error: 'tenant_scope_denied' });
    }
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb) return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
    return res.json({
      ok: true,
      tenantId: targetTenant,
      features: targetDb.featureEntitlements || {}
    });
  }

  if (req.path === '/api/admin/features/toggle' && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.sendStatus(204);
  }

  if (req.path === '/api/admin/features/toggle' && req.method === 'POST') {
    applyAdminCors();
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    const localControlPlane = isTrustedLocalControlPlaneOrigin(req);
    if (!hasBridgeCredential && !localControlPlane) {
      return res.status(401).json({
        ok: false,
        error: 'control_plane_bridge_required',
        message: 'تغییر قابلیت‌ها فقط از مسیر احراز‌شدهٔ کنترل پلتفرم انجام می‌شود.'
      });
    }

    const { featureKey, featureKeys, enabled, tenantId } = req.body || {};
    const requestedKeys = Array.isArray(featureKeys) && featureKeys.length
      ? [...new Set(featureKeys)]
      : (featureKey ? [featureKey] : []);
    if (!requestedKeys.length) {
      return res.status(400).json({ ok: false, error: 'featureKey_required' });
    }
    if (requestedKeys.length > CANONICAL_FEATURES.length || requestedKeys.some(key => typeof key !== 'string')) {
      return res.status(400).json({ ok: false, error: 'invalid_feature_keys' });
    }
    const canonicalKeys = new Set(CANONICAL_FEATURES.map(feature => feature.key));
    const unknownKeys = requestedKeys.filter(key => !canonicalKeys.has(key));
    if (unknownKeys.length) {
      return res.status(422).json({ ok: false, error: 'unknown_feature_keys', featureKeys: unknownKeys });
    }

    const requestTenant = normalizeTenantId(req.tenantContext?.tenantId || req.tenantSlug || TENANT_CONFIG.tenantId);
    const targetTenant = normalizeTenantId(tenantId || requestTenant);
    if (!targetTenant) return res.status(400).json({ ok: false, error: 'tenant_id_invalid' });
    if (targetTenant !== requestTenant && !hasBridgeCredential && !localControlPlane) {
      return res.status(403).json({ ok: false, error: 'tenant_scope_denied' });
    }
    const persistenceError = legacyTenantPersistenceError({ tenantId: targetTenant });
    if (persistenceError) {
      return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
    }
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb) {
      return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
    }
    if (!targetDb.featureEntitlements) targetDb.featureEntitlements = {};
    const updatedAt = new Date().toISOString();
    for (const key of requestedKeys) {
      targetDb.featureEntitlements[key] = {
        active: Boolean(enabled),
        status: enabled ? 'active' : 'disabled',
        updatedAt
      };
    }
    tenantRegistry.saveTenantDb(targetTenant);

    return res.json({
      ok: true,
      tenantId: targetTenant,
      featureKey: requestedKeys[0],
      featureKeys: requestedKeys,
      enabled: Boolean(enabled),
      updatedAt,
      message: `${requestedKeys.length} قابلیت برای مستأجر ${targetTenant} به وضعیت ${enabled ? 'فعال' : 'غیرفعال'} تغییر یافت.`
    });
  }

  if (req.path.startsWith('/api/admin/features') && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.status(204).end();
  }

  // Multi-tenant provisioning & management APIs
  if (req.path.startsWith('/api/admin/tenants') && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.status(204).end();
  }

  if (req.path === '/api/admin/tenants/provision' && req.method === 'POST') {
    applyAdminCors();
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    const localControlPlane = isTrustedLocalControlPlaneOrigin(req);
    if (!hasBridgeCredential && !localControlPlane) {
      return res.status(401).json({
        ok: false,
        error: 'control_plane_bridge_required',
        message: 'ایجاد tenant فقط از مسیر احراز‌شدهٔ کنترل پلتفرم انجام می‌شود.'
      });
    }

    const input = req.body || {};
    const tenantId = normalizeTenantId(input.tenantId);
    const { name, brandName, domain, enabledFeatures } = input;
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenantId_required' });
    }

    const persistenceError = legacyTenantPersistenceError({ tenantId });
    if (persistenceError) {
      return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
    }

    const cleanDb = tenantRegistry.createTenant(tenantId, {
      name: name || brandName || tenantId,
      brandName: brandName || name || tenantId,
      domain: domain || `${tenantId}.salsa.ir`,
      enabledFeatures: Array.isArray(enabledFeatures) ? enabledFeatures : ['core.workspace', 'catalog.menu']
    });

    return res.status(201).json({
      ok: true,
      tenantId,
      name: cleanDb.settings?.restaurantName,
      domain: `${tenantId}.salsa.ir`,
      message: `مستأجر خام «${tenantId}» با موفقیت ایجاد شد و آماده پیکربندی از مرکز فرماندهی SALSA است.`
    });
  }

  if (req.path === '/api/admin/tenants' && req.method === 'GET') {
    applyAdminCors();
    if (!hasControlPlaneBridgeCredential(req) && !isTrustedLocalControlPlaneOrigin(req)) {
      return res.status(401).json({ ok: false, error: 'control_plane_bridge_required' });
    }
    const list = tenantRegistry.listTenants();
    return res.json({
      ok: true,
      tenants: list
    });
  }

  next();
});

moduleRuntime.registerHttpRoute('platform_core', 'get-015', moduleRouteContext);

// Deep links keep the relevant SALSA workspace reachable from the matching
// WESTO admin section while the two runtimes remain isolated.
const SALSA_OPERATION_VIEWS = new Set([
  'tables', 'customers', 'marketing', 'reservations', 'waiter-panel',
  'fin-overview', 'fin-sales', 'fin-cash-drawers', 'fin-settlements',
  'fin-journal', 'fin-gl', 'fin-coa', 'fin-trial-balance', 'fin-reports',
  'fin-period-close', 'fin-command-center', 'fin-expenses', 'fin-bank-feed',
  'fin-three-way-match', 'fin-tax-matrix',
]);
const NEEM_OPERATION_VIEWS = SALSA_OPERATION_VIEWS;

moduleRuntime.registerHttpRoute('platform_core', 'get-016', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-017', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-018', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-019', moduleRouteContext);

// --- auth ---
moduleRuntime.registerHttpRoute('platform_core', 'post-020', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-021', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-022', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-023', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'patch-024', moduleRouteContext);

// --- user avatar endpoints ---
const userAvatarUpload = multer({
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype)) {
      return cb(new Error('فقط فایل‌های تصویری (PNG, JPG, WebP, GIF) مجاز هستند.'));
    }
    cb(null, true);
  },
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS, 'avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '.png') || '.png';
      cb(null, `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
});

moduleRuntime.registerHttpRoute('website_brand', 'post-025', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-026', moduleRouteContext);

// --- user multi-addresses API ---
moduleRuntime.registerHttpRoute('platform_core', 'get-027', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-028', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'put-029', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'delete-030', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-031', moduleRouteContext);

// --- Customer Feedback & Reviews ---
moduleRuntime.registerHttpRoute('crm', 'post-032', moduleRouteContext);

// --- content ---
// Keep the catalogue response self-contained so every consumer (public menu,
// admin editor, waiter and cashier) sees the same explicitly configured
// choices. Missing configuration means no modifiers; it must never synthesize
// saleable options or prices from product names.
function menuItemForResponse(item) {
  return {
    ...item,
    modifierGroups: effectiveModifierGroupsForItem(item),
  };
}

function publicGuestMenuPayload(query = {}) {
  let items = db.menuItems;
  const requestedBranch = query.branchId || query.branch;
  const branch = requestedBranch ? resolveBranchExact(requestedBranch) : defaultBranch();
  const branchId = branch?.id || null;
  if (branchId) items = items.filter((item) => menuItemBelongsToBranch(item, branchId));
  if (!query.all) {
    items = items.filter((m) => {
      if (!menuItemAvailableForBranch(db, m, branchId) || !itemVisibleNow(m)) return false;
      if (typeof m.stock === 'number' && m.stock <= 0) return false;
      const availability = branchId ? financeV2.menuItemAvailability(db, m.id, branchId) : null;
      if (availability?.tracked && !availability.available && db.settings?.enforceInventoryStock) return false;
      return true;
    });
  }
  if (query.categoryId) {
    const cid = Number(query.categoryId);
    items = items.filter((m) => m.categoryId === cid);
  }
  if (query.excludeAllergen) {
    const exclude = String(query.excludeAllergen)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (exclude.length) {
      items = items.filter((m) => !(m.allergens || []).some((allergen) => exclude.includes(allergen)));
    }
  }

  return {
    menuCategories: db.menuCategories,
    menuItems: items.map((item) => ({
      ...menuItemForResponse(item),
      available: menuItemAvailableForBranch(db, item, branchId),
    })),
    siteCategories: activeMenuCategories(db),
    menuRevision: db.menuRevision || 0,
    allergens: ALLERGENS,
    dayparts: DAYPARTS.map(({ id, label }) => ({ id, label })),
    activeDayparts: currentDaypartIds(),
    i18n: db.i18n || { guestLangEnabled: true, defaultLang: 'fa', supported: ['fa', 'en', 'ar'] },
  };
}

function publicRestaurantPayload(branchToken) {
  const branch = resolveBranch(branchToken);
  const tables = (db.tables || []).filter(
    (table) => table.active !== false && (!branch || Number(table.branchId) === branch.id),
  );

  return {
    restaurant: db.restaurant,
    hours: branch?.hours || db.hours,
    branch: branch
      ? {
          id: branch.id,
          slug: branch.slug,
          name: branch.name,
          address: branch.address,
          phone: branch.phone,
          whatsapp: branch.whatsapp,
        }
      : null,
    branches: (db.branches || [])
      .filter((item) => item.active !== false)
      .map((item) => ({ id: item.id, slug: item.slug, name: item.name })),
    tables,
    theme: db.theme,
  };
}

function publicContentPayload({ includeUnavailable = true } = {}) {
  // The public bootstrap is also the source for the static Sites publication
  // and the standalone checkout. Do not let an incomplete inventory snapshot
  // erase the catalogue before a guest can see it. The order endpoint still
  // enforces menu flags, dayparts and branch inventory at submission time.
  const menu = publicGuestMenuPayload(includeUnavailable ? { all: true } : {});
  const restaurantPayload = publicRestaurantPayload();
  return {
    tenantId: tenantStorage.getStore()?.tenantId || db.tenantIdentity?.tenantId || TENANT_CONFIG.tenantId,
    content: db.content,
    products: db.products,
    // Keep the historical top-level fields for content-overrides.js and older
    // static builds while publishing exact current menu/restaurant payloads for
    // the performance loader. This removes two startup API round trips without
    // changing the public API contracts.
    menuCategories: db.menuCategories,
    menuItems: menu.menuItems,
    siteCategories: activeMenuCategories(db),
    menuRevision: db.menuRevision || 0,
    menu,
    restaurantPayload,
    promoSlides: publicPromoSlides(),
    faq: db.faq,
    settings: { siteTitle: db.settings.siteTitle, metaDescription: db.settings.metaDescription },
  };
}

// Parser-friendly bootstrap: its preload overlaps HTML parsing and replaces
// the old synchronous XHR without introducing a race with SplitText/Three.
moduleRuntime.registerHttpRoute('menu_qr', 'get-033', moduleRouteContext);

// A new restaurant must never inherit WESTO's offline commercial snapshot.
// Keep the legacy URL and hydrate the same UI with this request's tenant data.
moduleRuntime.registerHttpRoute('menu_qr', 'get-034', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'get-035', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'put-036', moduleRouteContext);

// --- products: read-only derived view (writes go through /api/menu/categories) ---
moduleRuntime.registerHttpRoute('menu_qr', 'put-037', moduleRouteContext);

// --- menu items (orderable dishes) ---
moduleRuntime.registerHttpRoute('menu_qr', 'get-038', moduleRouteContext);

function complementRulesForMenuItem(menuItem) {
  if (!menuItem) return [];
  return (db.menuComplementRules || []).filter((rule) => rule.active !== false && (
    (rule.sourceItemIds || []).includes(Number(menuItem.id)) ||
    (rule.sourceCategoryIds || []).includes(Number(menuItem.categoryId))
  ));
}

function staffMenuPayload(branchToken = null) {
  const branch = resolveBranch(branchToken);
  const branchId = branch?.id || null;
  return {
    menuCategories: db.menuCategories || [],
    menuItems: (db.menuItems || []).map((item) => {
      const availability = branchId ? financeV2.menuItemAvailability(db, item.id, branchId) : null;
      const resp = menuItemForResponse(item);
      resp.available = menuItemAvailableForBranch(db, item, branchId);
      resp.inventoryTracked = Boolean(availability?.tracked);
      resp.inventoryAvailable = availability ? Boolean(availability.available) : true;
      resp.capacity = availability && Number.isFinite(availability.capacity) ? availability.capacity : null;
      resp.inventoryIssues = availability?.issues || [];
      return resp;
    }),
    menuComplements: (db.menuComplements || []).filter((item) => item.available !== false && (item.stock == null || Number(item.stock) > 0)),
    menuComplementRules: (db.menuComplementRules || []).filter((rule) => rule.active !== false),
    menuRevision: db.menuRevision || 0,
  };
}

moduleRuntime.registerHttpRoute('platform_core', 'get-039', moduleRouteContext);

function normalizeComplementInput(input = {}, current = {}) {
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const img = input.img !== undefined ? sanitizeMenuImg(input.img) : (current.img || '');
  if (img === null) return { error: 'مسیر تصویر مکمل نامعتبر است' };
  const stockRaw = input.stock !== undefined ? input.stock : current.stock;
  const parsedStock = parseNum(stockRaw);
  const stock = stockRaw == null || stockRaw === '' ? null : Math.max(0, Math.round(parsedStock ?? 0));
  const rawPrice = parseNum(input.price !== undefined ? input.price : current.price);
  const rawLow = parseNum(input.lowStockAt !== undefined ? input.lowStockAt : current.lowStockAt);
  const complement = {
    ...current,
    name: String(input.name !== undefined ? input.name : current.name || '').trim().slice(0, 120),
    price: Math.max(0, Math.round(rawPrice ?? 0)),
    img: img || '',
    available: input.available !== undefined ? input.available !== false : current.available !== false,
    stock,
    lowStockAt: Math.max(0, Math.round(rawLow ?? 5)),
    description: String(input.description !== undefined ? input.description : current.description || '').trim().slice(0, 500),
  };
  if (!complement.name) return { error: 'نام مکمل را وارد کنید' };
  if (stock === 0) complement.available = false;
  return { complement };
}

function normalizeComplementRuleInput(input = {}, current = {}) {
  const validCategoryIds = new Set((db.menuCategories || []).map((item) => Number(item.id)));
  const validItemIds = new Set((db.menuItems || []).map((item) => Number(item.id)));
  const validComplementIds = new Set((db.menuComplements || []).map((item) => Number(item.id)));
  const ids = (value, valid) => [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((v) => Number(normalizeDigits(String(v)).replace(/\D/g, '')))
        .filter((id) => Number.isFinite(id) && valid.has(id))
    ),
  ];
  const rule = {
    ...current,
    name: String(input.name !== undefined ? input.name : current.name || '').trim().slice(0, 120),
    prompt: String(input.prompt !== undefined ? input.prompt : current.prompt || '').trim().slice(0, 180),
    sourceCategoryIds: ids(input.sourceCategoryIds !== undefined ? input.sourceCategoryIds : current.sourceCategoryIds, validCategoryIds),
    sourceItemIds: ids(input.sourceItemIds !== undefined ? input.sourceItemIds : current.sourceItemIds, validItemIds),
    complementIds: ids(input.complementIds !== undefined ? input.complementIds : current.complementIds, validComplementIds),
    active: input.active !== undefined ? input.active !== false : current.active !== false,
  };
  if (!rule.name) return { error: 'نام قانون را وارد کنید' };
  if (!rule.prompt) rule.prompt = 'مکملی برای این سفارش اضافه شود؟';
  if (!rule.sourceCategoryIds.length && !rule.sourceItemIds.length) return { error: 'حداقل یک دسته یا محصول پایه انتخاب کنید' };
  if (!rule.complementIds.length) return { error: 'حداقل یک مکمل انتخاب کنید' };
  return { rule };
}

moduleRuntime.registerHttpRoute('menu_qr', 'get-040', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-041', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'put-042', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'delete-043', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-044', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'put-045', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'delete-046', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-047', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-048', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'put-049', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-050', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-051', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-052', moduleRouteContext);

function assertVisibleCategoryCover(cat) {
  if (cat.hiddenOnSite) return null;
  if (!categoryHasCover(cat)) {
    return 'برای نمایش روی صفحه اصلی باید کاور دسته را آپلود کنید';
  }
  return null;
}

/* Category CRUD — register before /api/menu/:id */
moduleRuntime.registerHttpRoute('menu_qr', 'post-053', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'put-054', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'put-055', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'delete-056', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'put-057', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'patch-058', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-059', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-060', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-061', moduleRouteContext);
moduleRuntime.registerHttpRoute('menu_qr', 'delete-062', moduleRouteContext);

// --- orders ---
function parseOrderTomanAmount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = normalizeDigits(value).replace(/[,_\s٬]/gu, '').trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function orderLinesFromRequest(rawItems, {
  allowMenuItemIds = new Set(), allowComplementIds = new Set(), branchId = null,
  excludeInventoryReservationOrderId = null,
} = {}) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { error: 'order_items_required', code: 'order_items_required', status: 400 };
  }
  const items = rawItems;
  const lines = [];
  let subtotal = 0;
  const requestedMenuQty = new Map();
  const requestedComplementQty = new Map();
  for (let lineIndex = 0; lineIndex < items.length; lineIndex += 1) {
    const line = items[lineIndex];
    const lineShape = validateOrderLineInput(line, lineIndex);
    if (!lineShape.ok) {
      return {
        error: lineShape.error,
        code: lineShape.error,
        status: 400,
        message: 'تعداد، گزینه‌ها یا اطلاعات یکی از اقلام سفارش معتبر نیست؛ سبد را بازبینی کنید.',
        index: lineShape.index,
      };
    }
    const menuItemId = Number(line.menuItemId || line.id);
    const menuItem = db.menuItems.find((item) => item.id === menuItemId
      && (menuItemAvailableForBranch(db, item, branchId) || allowMenuItemIds.has(menuItemId)));
    if (!menuItem || !menuItemBelongsToBranch(menuItem, branchId)
        || (!allowMenuItemIds.has(menuItemId) && !itemVisibleNow(menuItem))) {
      return { error: 'item_unavailable', message: 'یکی از اقلام سفارش دیگر در دسترس نیست؛ سبد را بازبینی کنید.' };
    }
    const qty = Math.min(99, Math.max(1, Math.round(Number(line.qty || line.count) || 1)));
    const accumulatedMenuQty = (requestedMenuQty.get(menuItemId) || 0) + qty;
    const v2Availability = branchId
      ? financeV2.menuItemAvailability(db, menuItem.id, branchId, accumulatedMenuQty, undefined, {
        excludeOrderId: excludeInventoryReservationOrderId,
      })
      : null;
    if (v2Availability?.tracked) {
      if (!v2Availability.available) {
        const shortage = v2Availability.issues?.find((issue) => issue.code === 'inventory_shortage');
        return { error: shortage?.itemName ? `مواد لازم برای «${menuItem.name}» کافی نیست (ماده: ${shortage.itemName})` : `موجودی مواد لازم برای «${menuItem.name}» کافی نیست` };
      }
    } else if (typeof menuItem.stock === 'number' && menuItem.stock < accumulatedMenuQty) {
      return { error: `موجودی «${menuItem.name}» کافی نیست (باقی‌مانده: ${menuItem.stock})` };
    }
    requestedMenuQty.set(menuItemId, accumulatedMenuQty);
    const rawModifierGroups = Array.isArray(menuItem.modifierGroups) ? menuItem.modifierGroups : [];
    const modifierGroupValidation = validateModifierGroupDefinitions(rawModifierGroups);
    if (!modifierGroupValidation.ok) {
      return {
        error: 'modifier_configuration_invalid',
        code: 'modifier_configuration_invalid',
        status: 409,
        message: `گزینه‌های «${menuItem.name}» نیازمند بازبینی مدیریت منو هستند.`,
        details: modifierGroupValidation.errors,
      };
    }
    const priceResult = calculateModifierLinePrice(
      menuItem.price,
      qty,
      modifierGroupValidation.groups,
      line.modifiers,
    );
    if (!priceResult.ok) {
      return {
        error: 'modifier_selection_invalid',
        code: 'modifier_selection_invalid',
        status: 400,
        message: 'گزینه‌های انتخاب‌شده معتبر نیستند یا یک انتخاب اجباری جا افتاده است؛ سبد را بازبینی کنید.',
        details: priceResult.errors || [{ code: priceResult.error }],
      };
    }
    const price = priceResult.basePrice;
    const modifiers = priceResult.modifiers;
    const unitTotal = priceResult.unitPrice;
    const allowedComplementIds = new Set(complementRulesForMenuItem(menuItem).flatMap((rule) => rule.complementIds || []).map(Number));
    const complementQuantities = new Map();
    for (const entry of (Array.isArray(line.complements) ? line.complements : [])) {
      const complementId = Number(entry?.complementId ?? entry?.id);
      if (!allowedComplementIds.has(complementId) && !allowComplementIds.has(complementId)) {
        return {
          error: 'complement_selection_invalid',
          code: 'complement_selection_invalid',
          status: 400,
          message: 'یکی از افزودنی‌های انتخاب‌شده برای این کالا معتبر نیست.',
          index: lineIndex,
        };
      }
      const complementQty = Number(entry.qty);
      complementQuantities.set(complementId, (complementQuantities.get(complementId) || 0) + complementQty);
    }
    const complements = [];
    for (const [complementId, complementQty] of complementQuantities) {
      const complement = (db.menuComplements || []).find((entry) => Number(entry.id) === complementId
        && (allowComplementIds.has(complementId)
          || (entry.available !== false && (entry.stock == null || Number(entry.stock) > 0))));
      if (!complement) {
        return {
          error: 'complement_unavailable',
          code: 'complement_unavailable',
          status: 409,
          message: 'یکی از افزودنی‌های انتخاب‌شده دیگر در دسترس نیست؛ سبد را بازبینی کنید.',
          index: lineIndex,
        };
      }
      const accumulatedComplementQty = (requestedComplementQty.get(complementId) || 0) + complementQty;
      if (typeof complement.stock === 'number' && complement.stock < accumulatedComplementQty) {
        return { error: `موجودی مکمل «${complement.name}» کافی نیست (باقی‌مانده: ${complement.stock})` };
      }
      requestedComplementQty.set(complementId, accumulatedComplementQty);
      const complementPrice = Math.max(0, Number(complement.price) || 0);
      complements.push({ id: complement.id, name: complement.name, price: complementPrice, qty: complementQty, img: complement.img || '', lineTotal: complementPrice * complementQty });
    }
    const complementTotal = complements.reduce((sum, complement) => sum + complement.lineTotal, 0);
    const lineTotal = priceResult.lineTotal + complementTotal;
    if (!Number.isSafeInteger(complementTotal) || !Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
      return { error: 'order_amount_unsafe', code: 'order_amount_unsafe', status: 400, message: 'مبلغ سفارش از محدودهٔ مجاز بیشتر است.' };
    }
    const validCourses = ['straight_fire', 'starters', 'entrees', 'dessert'];
    const rawCourse = String(line.course || '').trim().toLowerCase();
    const course = validCourses.includes(rawCourse) ? rawCourse : 'starters';
    const rawCourseStatus = String(line.courseStatus || '').trim().toLowerCase();
    const courseStatus = ['hold', 'fired', 'served'].includes(rawCourseStatus) ? rawCourseStatus : 'fired';
    const firedAt = courseStatus === 'fired' ? (line.firedAt || new Date().toISOString()) : null;

    lines.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      price,
      qty,
      ...(typeof (menuItem.taxCategory || menuItem.taxCode) === 'string' && String(menuItem.taxCategory || menuItem.taxCode).trim()
        ? { taxCategory: String(menuItem.taxCategory || menuItem.taxCode).trim() }
        : {}),
      modifiers,
      complements,
      note: String(line.note || '').trim().slice(0, 180),
      seat: Math.min(99, Math.max(0, Math.round(Number(line.seat) || 0))),
      course,
      courseStatus,
      firedAt,
      unitTotal,
      lineTotal,
    });
    subtotal += lineTotal;
  }
  if (!lines.length) return { error: 'هیچ محصول معتبری در سفارش نیست' };
  return { lines, subtotal };
}


function orderInventorySnapshot() {
  return {
    menu: (db.menuItems || []).map((item) => ({ item, stock: item.stock, available: item.available })),
    complements: (db.menuComplements || []).map((item) => ({ item, stock: item.stock, available: item.available })),
  };
}

function restoreOrderInventorySnapshot(snapshot) {
  for (const entry of [...(snapshot?.menu || []), ...(snapshot?.complements || [])]) {
    entry.item.stock = entry.stock;
    entry.item.available = entry.available;
  }
}

function adjustOrderInventory(lines, direction, branchId = null) {
  for (const line of lines || []) {
    const menuItem = (db.menuItems || []).find((item) => Number(item.id) === Number(line.menuItemId));
    const usesV2 = branchId && menuItem ? financeV2.menuItemUsesInventoryV2(db, menuItem.id, branchId) : false;
    if (menuItem && !usesV2 && typeof menuItem.stock === 'number') {
      menuItem.stock = Math.max(0, menuItem.stock + direction * Number(line.qty || 0));
      if (direction > 0 && menuItem.stock > 0) menuItem.available = true;
      if (direction < 0 && menuItem.stock === 0) menuItem.available = false;
    }
    for (const selected of line.complements || []) {
      const complement = (db.menuComplements || []).find((item) => Number(item.id) === Number(selected.id || selected.complementId));
      if (complement && typeof complement.stock === 'number') {
        complement.stock = Math.max(0, complement.stock + direction * Number(selected.qty || 0));
        if (direction > 0 && complement.stock > 0) complement.available = true;
        if (direction < 0 && complement.stock === 0) complement.available = false;
      }
    }
  }
}

function canonicalTableNo(value) {
  return normalizeDigits(String(value || ''))
    .trim()
    .replace(/^میز\s*/u, '')
    .replace(/\s+/g, '');
}

function tableNoBelongsToTable(tableNo, tableId) {
  const actual = canonicalTableNo(tableNo);
  const target = canonicalTableNo(tableId);
  return Boolean(actual && target && (actual === target || actual.startsWith(`${target}-`)));
}

function tableForBranch(tableNo, branchId) {
  const cleanTable = canonicalTableNo(tableNo);
  return (db.tables || []).find((item) => {
    const itemBranchId = Number(item.branchId || defaultBranch()?.id || 1);
    if (Number(itemBranchId) !== Number(branchId)) return false;
    return canonicalTableNo(item.id) === cleanTable || canonicalTableNo(item.label) === cleanTable;
  }) || null;
}

function activeDineInOrderOnTable(order, tableNo, branchId) {
  if (!order || Number(order.branchId || defaultBranch()?.id || 1) !== Number(branchId)) return false;
  const fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
  const status = String(order.status || '');
  const paymentStatus = paymentStatusFor(order);
  const serviceComplete = ['done', 'picked_up', 'delivered'].includes(status);
  const paymentNeedsAttention = ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(paymentStatus);
  return fulfillment === 'dine_in'
    && tableNoBelongsToTable(order.tableNo, tableNo)
    && status !== 'cancelled'
    && (!serviceComplete || paymentNeedsAttention);
}

function nextDineInCheckNo(branchId, tableNo, preferred = '') {
  const normalizedTable = canonicalTableNo(tableNo);
  const baseTable = normalizedTable.replace(/-\d+$/u, '') || normalizedTable;
  const activeOrders = (db.orders || []).filter((order) => activeDineInOrderOnTable(order, baseTable, branchId));
  const used = new Set(activeOrders.flatMap((order) => [canonicalTableNo(order.checkNo), canonicalTableNo(order.tableNo)]).filter(Boolean));
  const requested = canonicalTableNo(preferred);
  const first = requested || baseTable;
  if (first && !used.has(first)) return first;
  let suffix = 2;
  while (used.has(`${baseTable}-${suffix}`)) suffix += 1;
  return `${baseTable}-${suffix}`;
}

function findOrderBranch(input, tableNo, fulfillment) {
  const requestedBranch = input.branchId || input.branch;
  const selected = requestedBranch ? resolveBranchExact(requestedBranch) : defaultBranch();
  if (requestedBranch && !selected) return null;
  if (fulfillment !== 'dine_in') return selected || defaultBranch();
  const cleanTable = normalizeDigits(String(tableNo || '')).trim();
  const tableKey = canonicalTableNo(cleanTable);
  const matchingTables = (db.tables || []).filter((item) => item.active !== false
    && (canonicalTableNo(item.id) === tableKey || canonicalTableNo(item.label) === tableKey));
  const scopedTables = selected
    ? matchingTables.filter((item) => Number(item.branchId) === Number(selected.id))
    : matchingTables;
  if (scopedTables.length !== 1) return null;
  const table = scopedTables[0];
  const tableBranch = (db.branches || []).find((branch) => branch.active !== false && Number(branch.id) === Number(table.branchId));
  if (!tableBranch || (selected && Number(selected.id) !== Number(tableBranch.id))) return null;
  return tableBranch;
}

function validateExplicitCheckoutSelections(input) {
  if (Object.hasOwn(input || {}, 'fulfillment')) {
    const fulfillment = typeof input.fulfillment === 'string' ? input.fulfillment.trim() : '';
    if (!FULFILLMENTS.includes(fulfillment)) {
      return { error: 'fulfillment_invalid', code: 'fulfillment_invalid', status: 400, message: 'روش دریافت انتخاب‌شده معتبر نیست.' };
    }
  }
  if (Object.hasOwn(input || {}, 'paymentMethod')) {
    const paymentMethod = typeof input.paymentMethod === 'string' ? input.paymentMethod.trim() : '';
    if (!['cashier', 'online'].includes(paymentMethod)) {
      return { error: 'payment_method_invalid', code: 'payment_method_invalid', status: 400, message: 'روش پرداخت انتخاب‌شده معتبر نیست.' };
    }
  }
  return null;
}

function publicPaymentAttempt(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    createdAt: payment.createdAt,
  };
}

function appendOrderStatus(order, status, actor = null, meta = {}) {
  order.status = status;
  order.statusAt = new Date().toISOString();
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({
    status,
    at: order.statusAt,
    by: actor ? { phone: actor.phone, role: effectiveRole(actor), name: actor.name || '' } : null,
    meta,
  });
  if (status === 'preparing' && !order.startedAt) order.startedAt = order.statusAt;
  if (status === 'ready') order.readyAt = order.statusAt;
  if (status === 'dispatched') order.dispatchedAt = order.statusAt;
  if (order.fulfillment === 'delivery' && ['dispatched', 'delivered', 'cancelled'].includes(status)) {
    order.delivery = order.delivery && typeof order.delivery === 'object' ? order.delivery : {};
    order.delivery.dispatchStatus = status;
    if (status === 'dispatched') order.delivery.dispatchedAt = order.delivery.dispatchedAt || order.statusAt;
    if (status === 'delivered') {
      order.delivery.dispatchedAt = order.delivery.dispatchedAt || order.dispatchedAt || order.statusAt;
      order.delivery.deliveredAt = order.delivery.deliveredAt || order.statusAt;
    }
  }
  if (['done', 'picked_up', 'delivered'].includes(status)) order.doneAt = order.statusAt;
}

function reverseCancelledOrderFinancialEffects(order, user) {
  const reason = `لغو سفارش #${order.orderNo || order.id}`;
  const actor = user?.phone || 'admin';
  const orderFinanceEvents = (db.financeV2?.events || []).filter((event) =>
    ['order.paid', 'order.cogs'].includes(event.source)
    && String(event.sourceId) === String(order.id));
  if (orderFinanceEvents.some((event) => Number(event.branchId) !== Number(order.branchId))) {
    throw Object.assign(new Error('شعبهٔ رویداد مالی با شعبهٔ سفارش هم‌خوان نیست؛ لغو بدون تطبیق مالی ثبت نشد.'), {
      code: 'order_finance_branch_mismatch',
      status: 409,
    });
  }
  const salesReversal = accountingEngine.reverseOrderSalesJournal(db, order.id, {
    reason,
    userId: actor,
  });
  const paidEvent = (db.financeV2?.events || []).find((event) => event.source === 'order.paid'
    && String(event.sourceId) === String(order.id)
    && event.journalEntryId);
  const financeSalesReversal = paidEvent
    ? financeV2.reverseEntry(db, paidEvent.journalEntryId, actor, reason)
    : null;
  const cogsReversal = financeV2.reverseOrderCogsAndInventory(db, order.id, actor, reason);
  const unreversedCogsJournal = (db.financeV2?.events || [])
    .filter((event) => event.source === 'order.cogs'
      && String(event.sourceId) === String(order.id)
      && event.journalEntryId)
    .map((event) => (db.financeV2?.journalEntries || []).find((entry) => entry.id === event.journalEntryId))
    .find((entry) => entry?.status === 'posted' && !entry.reversedById);
  if (unreversedCogsJournal) {
    throw Object.assign(new Error('سند بهای تمام‌شدهٔ سفارش معکوس نشد؛ لغو سفارش ثبت نشد.'), {
      code: 'order_cogs_reversal_incomplete',
      status: 409,
    });
  }
  return { salesReversal, financeSalesReversal, cogsReversal };
}

function checkoutIdempotencyFingerprint(input, actor = null) {
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const scopedRequest = {
    actor: actor ? { phone: String(actor.phone || ''), role: effectiveRole(actor) } : null,
    input,
  };
  return crypto.createHash('sha256').update(canonical(scopedRequest)).digest('hex');
}

function checkoutQuoteIntent({ input, branch, fulfillment, lines, subtotal, deliveryFee, discount, total, phone = input.phone, taxSnapshot = null }) {
  const tenantId = normalizeTenantId(
    tenantStorage.getStore()?.tenantId || db.tenantIdentity?.tenantId || TENANT_CONFIG.tenantId || 'westo',
  );
  const quoteLines = (lines || []).map((line) => ({
    menuItemId: Number(line.menuItemId),
    name: String(line.name || ''),
    price: Number(line.price) || 0,
    qty: Number(line.qty) || 0,
    modifiers: (line.modifiers || []).map((item) => ({ id: item.id, groupId: item.groupId, name: item.name, price: Number(item.price) || 0 })),
    complements: (line.complements || []).map((item) => ({ id: item.id, name: item.name, price: Number(item.price) || 0, qty: Number(item.qty) || 0 })),
    note: String(line.note || ''),
    seat: Number(line.seat) || 0,
    course: String(line.course || 'starters'),
    courseStatus: String(line.courseStatus || 'fired'),
  }));
  return {
    tenantId,
    branchId: Number(branch.id),
    fulfillment,
    tableNo: canonicalTableNo(input.tableNo || input.table),
    zoneId: Number(input.deliveryZoneId || input.zoneId) || null,
    phone: normalizeDigits(phone || '').trim(),
    paymentMethod: input.paymentMethod === 'online' ? 'online' : 'cashier',
    items: quoteLines,
    subtotal: Number(subtotal) || 0,
    deliveryFee: Number(deliveryFee) || 0,
    discount: Number(discount) || 0,
    total: Number(total) || 0,
    taxSnapshot,
  };
}

function calculateCheckoutPricing({ input, actor, subtotal, deliveryFee }) {
  const actorIsCustomer = effectiveRole(actor) === 'user';
  const phone = normalizeDigits(input.phone || (actorIsCustomer ? actor?.phone : '') || '').trim();
  const requestedManualDiscount = input.discount === undefined ? 0 : parseOrderTomanAmount(input.discount);
  if (requestedManualDiscount === null) {
    return { error: 'discount_invalid', code: 'discount_invalid', status: 400, message: 'مبلغ تخفیف باید عدد صحیح و معتبر باشد.' };
  }
  if (requestedManualDiscount > 0 && !userCan(actor, 'orders.manage')) {
    return { error: 'discount_not_allowed', status: 403, message: 'اعمال تخفیف دستی فقط برای نقش مجاز امکان‌پذیر است.' };
  }
  if (requestedManualDiscount > subtotal) {
    return { error: 'discount_exceeds_subtotal', code: 'discount_exceeds_subtotal', status: 400, message: 'تخفیف نمی‌تواند از جمع اقلام بیشتر باشد.' };
  }

  const actorPhone = normalizeDigits(actor?.phone || '').trim();
  const customerUser = actorIsCustomer && phone && actorPhone === phone
    ? (db.users || []).find((user) => normalizeDigits(user.phone || '').trim() === phone)
    : null;
  const discountCalc = customerUser
    ? loyaltyEngine.calculateOrderDiscounts(db, {
        subtotalToman: subtotal,
        phone,
        user: customerUser,
        redeemPoints: 0,
      })
    : {
        customerPhone: null,
        customerName: null,
        availablePoints: 0,
        tier: { id: 'none', name: 'بدون عضویت', discountPct: 0, multiplier: 1 },
        tierDiscountToman: 0,
        tierDiscountPct: 0,
        redeemValue: Math.max(0, Math.round(Number(db?.loyalty?.redeemValue) || 1000)),
        maxRedeemablePoints: 0,
        pointsRedeemed: 0,
        pointsDiscountToman: 0,
        totalDiscountToman: 0,
        finalPayable: subtotal,
      };
  const manualDiscount = userCan(actor, 'orders.manage') ? requestedManualDiscount : 0;
  const loyaltyDiscount = parseOrderTomanAmount(discountCalc.totalDiscountToman);
  if (loyaltyDiscount === null || loyaltyDiscount > subtotal) {
    return { error: 'loyalty_discount_invalid', code: 'loyalty_discount_invalid', status: 409, message: 'تخفیف وفاداری معتبر نیست؛ سفارش ثبت نشد.' };
  }
  const discount = Math.max(loyaltyDiscount, manualDiscount);
  const total = subtotal + deliveryFee - discount;
  if (!Number.isSafeInteger(total) || total < 0) {
    return { error: 'order_amount_unsafe', code: 'order_amount_unsafe', status: 400, message: 'مبلغ سفارش از محدودهٔ مجاز بیشتر است.' };
  }
  return { phone, customerUser, discountCalc, discount, total };
}

function checkoutTaxForOrder({ branch, fulfillment, lines, discount, deliveryFee, total, date }) {
  try {
    const snapshot = buildCheckoutTaxSnapshot({
      taxSettings: db.accounting?.taxSettings,
      branchId: branch?.id,
      fulfillment,
      lines,
      discountToman: discount,
      deliveryFeeToman: deliveryFee,
      date,
    });
    const expectedPayableIrr = Number(total) * 10;
    if (!Number.isSafeInteger(expectedPayableIrr) || snapshot.totalPayableIrr !== expectedPayableIrr) {
      return {
        error: 'checkout_tax_payable_mismatch',
        code: 'checkout_tax_payable_mismatch',
        status: 409,
        message: 'جمع پیش‌فاکتور با snapshot مالیاتی شعبه یکسان نیست؛ سفارش ثبت نشد.',
      };
    }
    return { snapshot };
  } catch (error) {
    return {
      error: error.code || 'checkout_tax_snapshot_unavailable',
      code: error.code || 'checkout_tax_snapshot_unavailable',
      status: error.status || 409,
      message: error.message || 'ثبت سفارش متوقف شد؛ تصویر مالیاتی معتبر برای شعبه در دسترس نیست.',
    };
  }
}

async function createCheckoutOrder(input, { requireTable = false, requirePhone = true, requireQuote = false, requireName = false, idempotencyKey = '', actor = null } = {}) {
  const tableNo = normalizeDigits(String(input.tableNo || input.table || '')).trim().slice(0, 20);
  const selectionError = validateExplicitCheckoutSelections(input);
  if (selectionError) return selectionError;
  const fulfillment = normalizeFulfillment(input.fulfillment, { tableNo });
  const phone = normalizeDigits(input.phone || (effectiveRole(actor) === 'user' ? actor?.phone : '') || '').trim();
  const name = String(input.name || '').trim().slice(0, 100);
  const paymentMethod = String(input.paymentMethod || 'cashier').trim() === 'online' ? 'online' : 'cashier';
  const normalizedKey = String(idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !normalizedKey) {
    return { error: 'idempotency_key_required', code: 'idempotency_key_required', status: 400, message: 'برای ثبت سفارش، کلید یکتای درخواست لازم است.' };
  }
  if (requireName && !name) {
    return { error: 'name_required', code: 'name_required', status: 400, message: 'نام گیرنده را وارد کنید.' };
  }
  if (normalizedKey && !ORDER_IDEMPOTENCY_KEY_RE.test(normalizedKey)) {
    return { error: 'idempotency_key_invalid', code: 'idempotency_key_invalid', status: 400 };
  }

  if ((requireTable || fulfillment === 'dine_in') && !tableNo) return { error: 'شماره میز را وارد کنید' };
  if ((requirePhone || phone) && !PHONE_RE.test(phone)) return { error: 'شماره موبایل معتبر نیست' };
  if (!Array.isArray(input.items) || !input.items.length) return { error: 'سبد سفارش خالی است' };

  const branch = findOrderBranch(input, tableNo, fulfillment);
  if (!branch || branch.active === false) return { error: 'شعبه پیدا نشد' };
  if (actor && effectiveRole(actor) !== 'user') {
    try {
      assertUserBranchAccess(actor, branch.id);
    } catch (error) {
      return { error: error.code || 'branch_access_denied', status: error.status || 403, message: error.message };
    }
  }

  const fingerprintInput = {
    ...input,
    branchId: Number(branch.id),
    fulfillment,
    tableNo: canonicalTableNo(tableNo),
    paymentMethod,
    phone,
  };
  delete fingerprintInput.quoteToken;
  const requestFingerprint = normalizedKey ? checkoutIdempotencyFingerprint(fingerprintInput, actor) : null;
  if (normalizedKey && Object.hasOwn(db.checkoutIdempotency || {}, normalizedKey)) {
    const saved = db.checkoutIdempotency[normalizedKey];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || typeof saved.requestFingerprint !== 'string') {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'اطلاعات بازیابی سفارش قبلی کامل نیست؛ برای سفارش تازه کلید جدید بسازید.' };
    }
    if (saved.requestFingerprint !== requestFingerprint) {
      return { error: 'idempotency_key_conflict', code: 'idempotency_key_conflict', status: 409, message: 'این کلید قبلاً برای درخواست دیگری استفاده شده است؛ برای سفارش تازه دوباره تلاش کنید.' };
    }
    const order = (db.orders || []).find((item) => Number(item.id) === Number(saved.orderId));
    if (!order) {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'سفارش قبلی این درخواست دیگر در دسترس نیست؛ برای ثبت سفارش تازه، کلید جدید بسازید.' };
    }
    if (persistedOrderBranchId(order) !== Number(branch.id)) {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'شعبهٔ سفارش قبلی با درخواست بازیابی هم‌خوان نیست.' };
    }
    const payment = saved.paymentAttemptId == null
      ? (order.paymentMethod === 'online' ? (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) : null)
      : (db.paymentAttempts || []).find((item) => Number(item.id) === Number(saved.paymentAttemptId));
    const paymentMatchesOrder = payment
      && Number(payment.orderId) === Number(order.id)
      && Number(payment.branchId) === Number(order.branchId)
      && Number.isSafeInteger(Number(payment.amount))
      && Number.isSafeInteger(Number(order.total))
      && Number(payment.amount) === Number(order.total);
    if ((saved.paymentAttemptId != null && (!payment
        || !paymentMatchesOrder))
      || (order.paymentMethod === 'online' && !paymentMatchesOrder)
      || (order.paymentMethod !== 'online' && payment)) {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'وضعیت پرداخت سفارش قبلی برای بازیابی امن کامل نیست.' };
    }
    if (actor && effectiveRole(actor) !== 'user') {
      try {
        assertUserBranchAccess(actor, order.branchId);
      } catch (error) {
        return { error: error.code || 'branch_access_denied', status: error.status || 403, message: error.message };
      }
    }
    return { order, payment, idempotent: true, whatsapp: null };
  }

  if (paymentMethod === 'online' && !productionPaymentProviderReady()) {
    return { error: 'payment_provider_not_ready', code: 'payment_provider_not_ready', status: 503 };
  }
  const lineResult = orderLinesFromRequest(input.items, { branchId: branch.id });
  if (lineResult.error) return lineResult;
  if (actor && effectiveRole(actor) !== 'user') {
    const addValidation = validateWaiterOrderAdd(input.items, {
      canonicalLines: lineResult.lines,
      sendToKitchen: input.sendToKitchen === true,
    });
    if (!addValidation.ok) {
      const message = addValidation.error === 'course_already_served'
        ? 'سفارش تازه نمی‌تواند قلمی با وضعیت «تحویل‌شده» داشته باشد.'
        : addValidation.error === 'kitchen_course_empty'
          ? 'برای ارسال سفارش، دست‌کم یک دوره باید برای آشپزخانه آماده باشد.'
          : 'اقلام سفارش با ساختار یا قیمت معتبر منو سازگار نیستند.';
      return {
        error: addValidation.error,
        code: addValidation.error,
        status: 400,
        message,
        ...(addValidation.index === undefined ? {} : { index: addValidation.index }),
      };
    }
  }
  const dineInCovers = fulfillment === 'dine_in'
    ? (input.covers === undefined ? 1 : Number(normalizeDigits(String(input.covers)).replace(/[^0-9]/g, '')))
    : null;
  if (fulfillment === 'dine_in') {
  const coverValidation = validateCoversForItems(dineInCovers, lineResult.lines);
    if (!coverValidation.ok) {
      return {
        error: coverValidation.error,
        code: coverValidation.error,
        status: 400,
        message: coverValidation.error === 'seat_exceeds_covers'
          ? 'تعداد مهمان نمی‌تواند از شمارهٔ صندلی تخصیص‌یافته کمتر باشد.'
          : 'تعداد مهمان باید بین ۱ تا ۹۹ نفر باشد.',
      };
    }
  }
  if (input.sendToKitchen === true && !lineResult.lines.some((line) => line.courseStatus === 'fired')) {
    return { error: 'kitchen_course_empty', code: 'kitchen_course_empty', status: 400, message: 'برای ارسال سفارش، دست‌کم یک مرحله باید به آشپزخانه فرستاده شود.' };
  }
  const zoneId = Number(input.deliveryZoneId || input.zoneId) || null;
  const zone = fulfillment === 'delivery'
    ? (db.deliveryZones || []).find((item) => Number(item.id) === zoneId)
    : null;
  const fulfillmentQuote = quoteFulfillment({
    fulfillment,
    subtotal: lineResult.subtotal,
    zone,
    branchId: branch.id,
  });
  if (!fulfillmentQuote.ok) return { error: fulfillmentQuote.message, code: fulfillmentQuote.code, minimum: fulfillmentQuote.minimum };
  const deliveryFee = parseOrderTomanAmount(fulfillmentQuote.deliveryFee);
  if (deliveryFee === null) {
    return { error: 'delivery_fee_invalid', code: 'delivery_fee_invalid', status: 409, message: 'هزینهٔ ارسال معتبر نیست؛ تنظیم محدودهٔ ارسال را بررسی کنید.' };
  }
  const deliveryAddress = String(input.deliveryAddress || input.address || '').trim().slice(0, 300);
  if (fulfillment === 'delivery' && !deliveryAddress) return { error: 'آدرس تحویل را وارد کنید' };

  const pricing = calculateCheckoutPricing({ input: { ...input, phone }, actor, subtotal: lineResult.subtotal, deliveryFee });
  if (pricing.error) return pricing;
  const { customerUser, discountCalc } = pricing;
  const orderDiscount = pricing.discount;
  const orderTotal = pricing.total;
  const createdAt = new Date().toISOString();
  const checkoutTax = checkoutTaxForOrder({
    branch,
    fulfillment,
    lines: lineResult.lines,
    discount: orderDiscount,
    deliveryFee,
    total: orderTotal,
    date: createdAt,
  });
  if (checkoutTax.error) return checkoutTax;
  if (requireQuote) {
    const quoteIntent = checkoutQuoteIntent({
      input: { ...input, tableNo, fulfillment, paymentMethod }, branch, fulfillment, lines: lineResult.lines, subtotal: lineResult.subtotal,
      deliveryFee, discount: orderDiscount, total: orderTotal, phone, taxSnapshot: checkoutTax.snapshot,
    });
    const verification = verifyCheckoutQuoteToken(input.quoteToken, SECRET, quoteIntent);
    if (!verification.valid) {
      return {
        error: verification.reason === 'missing_or_malformed' ? 'checkout_quote_required' : 'checkout_quote_stale',
        code: verification.reason === 'missing_or_malformed' ? 'checkout_quote_required' : 'checkout_quote_stale',
        status: 409,
        message: 'قیمت یا موجودی سفارش تغییر کرده است؛ مبلغ تازه را بررسی و دوباره ثبت کنید.',
      };
    }
  }

  const inventoryReservationSnapshot = financeV2.buildOrderInventoryReservationSnapshot(
    db, lineResult.lines, branch.id, createdAt,
  );
  if (!inventoryReservationSnapshot.ok) {
    return {
      error: 'inventory_reservation_unavailable',
      code: 'inventory_reservation_unavailable',
      status: 409,
      message: 'رزرو مواد اولیه برای این سفارش قابل ثبت نیست؛ موجودی و دستور تهیه را بررسی کنید.',
      details: inventoryReservationSnapshot.issues,
    };
  }

  // Deduct stock only after validating the current server-side quote.
  for (const line of lineResult.lines) {
    const menuItem = db.menuItems.find((item) => item.id === line.menuItemId);
    const usesV2 = menuItem && financeV2.menuItemUsesInventoryV2(db, menuItem.id, branch.id);
    if (menuItem && !usesV2 && typeof menuItem.stock === 'number') {
      menuItem.stock = Math.max(0, menuItem.stock - line.qty);
      if (menuItem.stock === 0) menuItem.available = false;
    }
    for (const selected of line.complements || []) {
      const complement = (db.menuComplements || []).find((item) => Number(item.id) === Number(selected.id));
      if (complement && typeof complement.stock === 'number') {
        complement.stock = Math.max(0, complement.stock - Number(selected.qty || 0));
        if (complement.stock === 0) complement.available = false;
      }
    }
  }
  const checkNo = fulfillment === 'dine_in'
    ? nextDineInCheckNo(branch.id, tableNo, input.checkNo || tableNo)
    : '';

  const order = {
    id: nextId(db.orders),
    orderNo: `W-${String(Date.now()).slice(-6)}-${nextId(db.orders)}`,
    tableNo: fulfillment === 'dine_in' ? tableNo : '',
    checkNo,
    phone,
    name,
    branchId: branch.id,
    fulfillment,
    ...(fulfillment === 'dine_in' ? { covers: dineInCovers } : {}),
    paymentMethod,
    paymentStatus: paymentMethod === 'online' ? 'pending' : 'unpaid',
    status: initialOrderStatus({ paymentMethod, fulfillment }),
    items: lineResult.lines,
    taxSnapshot: { ...checkoutTax.snapshot, capturedAt: createdAt },
    inventoryReservationSnapshot,
    subtotal: lineResult.subtotal,
    discount: orderDiscount,
    tierDiscountToman: discountCalc.tierDiscountToman,
    pointsRedeemed: discountCalc.pointsRedeemed,
    pointsDiscountToman: discountCalc.pointsDiscountToman,
    loyaltyTier: discountCalc.tier?.id || 'bronze',
    deliveryFee,
    total: orderTotal,
    delivery: fulfillment === 'delivery'
      ? {
          zoneId: zone.id,
          zoneName: zone.name,
          address: deliveryAddress,
          instructions: String(input.deliveryInstructions || input.instructions || '').trim().slice(0, 220),
          etaMinutes: fulfillmentQuote.etaMinutes,
          dispatchStatus: 'pending',
        }
      : null,
    note: String(input.note || '').trim().slice(0, 240),
    createdAt,
    statusAt: createdAt,
    statusHistory: [{
      status: initialOrderStatus({ paymentMethod, fulfillment }),
      at: createdAt,
      by: actor ? { phone: actor.phone, role: effectiveRole(actor), name: actor.name || '' } : null,
      meta: actor ? { source: 'staff-pos' } : undefined,
    }],
  };
  db.orders = Array.isArray(db.orders) ? db.orders : [];
  db.orders.unshift(order);
  db.orders = retainOperationalOrders(db.orders);

  let payment = null;
  if (paymentMethod === 'online') {
    db.paymentAttempts = Array.isArray(db.paymentAttempts) ? db.paymentAttempts : [];
    payment = {
      id: nextId(db.paymentAttempts),
      orderId: order.id,
      branchId: branch.id,
      tender: 'online',
      provider: 'sandbox',
      mode: 'sandbox',
      amount: order.total,
      status: 'pending',
      sandboxToken: crypto.randomBytes(18).toString('base64url'),
      createdAt,
      updatedAt: createdAt,
    };
    db.paymentAttempts.unshift(payment);
  }
  if (normalizedKey) {
    db.checkoutIdempotency = db.checkoutIdempotency || {};
    db.checkoutIdempotency[normalizedKey] = { orderId: order.id, paymentAttemptId: payment?.id || null, createdAt, requestFingerprint };
    // Do not evict replay records by count: a delayed retry after eviction
    // could otherwise create a second order. Production storage must move
    // this index to a durable table with explicit retention and expired-key handling.
  }
  const auditEntry = createAuditEntry({
    actor,
    action: 'order.created',
    targetType: 'order',
    targetId: order.id,
    branchId: branch.id,
    meta: { fulfillment, paymentMethod, total: order.total, source: actor ? 'staff-pos' : 'guest' },
  });
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift(auditEntry);
  db.auditLog = db.auditLog.slice(0, 5000);
  return { order, payment, whatsapp: null };
}

async function createAndPersistCheckoutOrder(input, options = {}, afterCreate = null) {
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  if (!idempotencyKey) return createAndPersistCheckoutOrderOnce(input, options, afterCreate);
  const tenantId = tenantStorage.getStore()?.tenantId
    || options.actor?.tenantId
    || db.tenantIdentity?.tenantId
    || TENANT_CONFIG.tenantId
    || 'westo';
  return serializeCheckoutOrderMutation(tenantId, idempotencyKey,
    () => createAndPersistCheckoutOrderOnce(input, options, afterCreate));
}

async function createAndPersistCheckoutOrderOnce(input, options = {}, afterCreate = null) {
  const snapshot = snapshotFinanceMutationState();
  let deferredCommit = null;
  let result;
  try {
    result = await createCheckoutOrder(input, options);
    if (result.error) {
      restoreFinanceMutationState(snapshot);
      return result;
    }
    if (!result.idempotent && afterCreate) deferredCommit = await afterCreate(result);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    throw error;
  }

  // These integrations are post-commit effects. A failed persistence must
  // never leave a live event, SALSA outbox row, or notification for a missing
  // order in the durable store.
  if (!result.idempotent) {
    try {
      publishOperationalEvent('order.created', { orderId: result.order.id, branchId: result.order.branchId, status: result.order.status });
      salsaBridge.enqueueOrder(result.order, result.payment);
      if (typeof deferredCommit === 'function') await deferredCommit();
      const notify = await notifyOrderWhatsApp(db, result.order);
      result.whatsapp = notify.skipped ? null : notify;
      await save({ requireDurable: true });
    } catch (error) {
      console.error('[order-post-commit] integration effect failed', error?.message || error);
      result.whatsapp = null;
    }
  }
  return result;
}

function settlePaymentAttempt(payment, { status = 'paid', reference = '', source = 'sandbox' } = {}) {
  if (!payment) return { error: 'payment_not_found' };
  status = String(status || '').trim().toLowerCase();
  const order = (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
  if (!order) return { error: 'payment_order_not_found', status: 409 };
  const paymentBranchId = Number(payment.branchId);
  const orderBranchId = Number(order.branchId);
  if (!Number.isSafeInteger(paymentBranchId) || paymentBranchId <= 0
    || !Number.isSafeInteger(orderBranchId) || orderBranchId <= 0
    || paymentBranchId !== orderBranchId) {
    return { error: 'payment_order_branch_mismatch', status: 409 };
  }
  const transition = paymentAttemptTransition(payment.status, status);
  if (!transition.ok) return { error: transition.error, status: 409 };
  const alreadyPaid = payment.status === 'paid' && status === 'paid';
  if (alreadyPaid && reference && String(reference).trim() !== String(payment.reference || '').trim()) {
    return { error: 'payment_reference_conflict', status: 409 };
  }
  if (transition.idempotent && !alreadyPaid) {
    const existingOrder = (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
    return { payment, order: existingOrder || null, finance: null, idempotent: true };
  }
  if (!alreadyPaid) {
    payment.status = status;
    payment.reference = String(reference || payment.reference || '').trim().slice(0, 160);
    payment.updatedAt = new Date().toISOString();
  }
  let financeResult = null;
  if (order) {
    if (status === 'paid') {
      financeResult = financeV2.captureOnlinePaidOrder(db, order, payment, { actor: `gateway:${payment.provider || source}`, occurredAt: payment.updatedAt });
      const financeState = db.financeV2 || {};
      const expectedSourceId = `${String(order.id)}:${String(payment.id)}`;
      const expectedAmountIrr = Number(payment.amount) * 10;
      const receiptEvent = (financeState.events || []).find((event) => event.id === payment.financeReceiptEventId);
      const receiptJournal = (financeState.journalEntries || []).find((entry) => entry.id === payment.financeReceiptJournalEntryId);
      const financePayment = (financeState.payments || []).find((row) => row.id === payment.financePaymentId);
      const matchingReceiptEvents = (financeState.events || []).filter((event) => event.source === 'order.payment_received'
        && String(event.sourceId) === expectedSourceId);
      const matchingReceiptJournals = (financeState.journalEntries || []).filter((entry) => entry.source === 'order.payment_received'
        && String(entry.sourceId) === expectedSourceId);
      const receiptPosted = Boolean(receiptEvent && receiptJournal && financePayment
        && matchingReceiptEvents.length === 1 && matchingReceiptJournals.length === 1
        && receiptEvent.source === 'order.payment_received'
        && String(receiptEvent.sourceId) === expectedSourceId
        && String(receiptEvent.payload?.paymentId) === String(payment.id)
        && receiptEvent.payload?.tender === 'online'
        && Number(receiptEvent.branchId) === orderBranchId
        && Number(receiptEvent.amountIrr) === expectedAmountIrr
        && receiptEvent.status === 'posted'
        && receiptEvent.journalEntryId === receiptJournal.id
        && receiptJournal.sourceEventId === receiptEvent.id
        && receiptJournal.source === 'order.payment_received'
        && String(receiptJournal.sourceId) === expectedSourceId
        && Number(receiptJournal.branchId) === orderBranchId
        && receiptJournal.status === 'posted'
        && String(financePayment.orderId) === String(order.id)
        && Number(financePayment.branchId) === orderBranchId
        && financePayment.tender === 'online'
        && Number(financePayment.amountIrr) === expectedAmountIrr
        && financePayment.status === 'succeeded'
        && String(financePayment.payload?.operationalPaymentId) === String(payment.id)
        && financePayment.receiptFinanceEventId === receiptEvent.id
        && financePayment.receiptJournalEntryId === receiptJournal.id);
      if (!receiptPosted) {
        throw Object.assign(new Error('پرداخت تأیید نشد چون رسید مستقل آن در دفتر مالی ثبت نشد.'), {
          code: receiptEvent?.error?.code || 'online_payment_receipt_finance_blocked', status: 409,
        });
      }
      // Partial captures are PSP-clearing receipts against customer deposits.
      // Recognize the sale only after all accepted captures cover the order.
      if (order.paymentStatus === 'paid' && (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted')) {
        const captureCode = financeResult?.event?.error?.code || financeResult?.reason || 'finance_capture_blocked';
        throw Object.assign(new Error('پرداخت تأیید نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
          code: captureCode,
          status: 409,
          details: financeResult?.event?.error || null,
        });
      }
      if (!['partial', 'paid'].includes(String(order.paymentStatus))) {
        throw Object.assign(new Error('وضعیت تجمیعی پرداخت پس از capture معتبر نیست.'), {
          code: 'online_payment_projection_invalid', status: 409,
        });
      }
      if (order.paymentStatus === 'paid') {
        const nextStatus = nextOrderStatusAfterPayment(order);
        if (nextStatus && canTransitionOrder(order, nextStatus)) {
          appendOrderStatus(order, nextStatus, null, { paymentAttemptId: payment.id, source });
        }
      }
    } else if (!['paid', 'partial'].includes(String(order.paymentStatus))) {
      // A failed/pending attempt must not erase successful partial captures.
      order.paymentStatus = orderPaymentStatusForAttempt(status) || 'unknown';
    }
  }
  recordAudit(null, `payment.${status}`, 'payment', payment.id, { orderId: payment.orderId, source }, payment.branchId);
  return { payment, order, finance: financeResult, idempotent: alreadyPaid };
}

function publishPaymentCommitEffects(result, status) {
  if (!result?.payment) return;
  publishOperationalEvent('payment.updated', {
    paymentId: result.payment.id, orderId: result.payment.orderId, branchId: result.payment.branchId, status,
  });
  if (result.order) publishOperationalEvent('order.updated', {
    orderId: result.order.id, branchId: result.order.branchId, status: result.order.status,
  });
  if (result.order) neemBridge.enqueueOrder(result.order, result.payment);
}

moduleRuntime.registerHttpRoute('platform_core', 'get-063', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-064', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-065', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-066', moduleRouteContext);

moduleRuntime.registerHttpRoute('menu_qr', 'post-067', moduleRouteContext);

moduleRuntime.registerHttpRoute('payments', 'post-068', moduleRouteContext);

const CUSTOMER_ORDER_STATUS_LABELS = Object.freeze({
  unknown: 'وضعیت سفارش نامشخص',
  pending: 'در انتظار تأیید',
  pending_online: 'در انتظار پرداخت آنلاین',
  pending_cashier: 'در انتظار پرداخت صندوق/پیک',
  pay_at_cashier: 'در انتظار پرداخت',
  awaiting_confirmation: 'در انتظار تأیید رستوران',
  prep: 'در حال آماده‌سازی',
  preparing: 'در حال پخت و آماده‌سازی',
  kitchen: 'در حال پخت در آشپزخانه',
  sent_to_kitchen: 'ارسال‌شده به آشپزخانه',
  ready: 'آماده تحویل',
  dispatched: 'در مسیر ارسال',
  delivering: 'در حال ارسال پیک',
  delivered: 'تحویل داده شد',
  picked_up: 'تحویل حضوری شد',
  paid: 'پرداخت و تکمیل‌شده',
  done: 'تکمیل‌شده',
  cancelled: 'لغوشده',
  rejected: 'رد شده',
});

function normalizeCustomerOrderStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return Object.hasOwn(CUSTOMER_ORDER_STATUS_LABELS, normalized) ? normalized : 'unknown';
}

function getOrderStatusFaLabel(status) {
  return CUSTOMER_ORDER_STATUS_LABELS[normalizeCustomerOrderStatus(status)];
}

function customerOrderStatusProjection(order) {
  const progress = customerOrderProgress(order);
  const paymentStatus = progress.paymentStatus || 'unknown';
  let status = normalizeCustomerOrderStatus(order?.status);
  // Legacy lifecycle rows marked "paid" without explicit payment evidence are
  // not sufficient to tell a customer that payment succeeded.
  if (status === 'paid' && paymentStatus !== 'paid') status = 'unknown';
  return {
    ...progress,
    paymentStatus,
    status,
    statusLabel: getOrderStatusFaLabel(status),
  };
}

function customerOwnsHistoryOrder(order, user) {
  // An explicit owner is authoritative. Never fall through to a matching
  // phone when the record belongs to a different account (or is malformed).
  // requireAuth resolves a session created only after OTP verification; phone
  // lookup is retained solely for genuinely unowned guest-order records.
  return loyaltyAchievements.orderBelongsToMember(order, user);
}

moduleRuntime.registerHttpRoute('pos', 'get-069', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-070', moduleRouteContext);

// Existing table ordering clients keep their endpoint and response shape.
moduleRuntime.registerHttpRoute('pos', 'post-071', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'get-072', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-073', moduleRouteContext);

const handleEditOrder = async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  // This route has no branch in its URL and the body is optional. Resolve the
  // order's canonical branch before exposing or mutating it; otherwise a
  // scoped cashier/manager could edit another branch simply by knowing its id.
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (req.body?.branchId && Number(req.body.branchId) !== Number(order.branchId)) {
    return res.status(404).json({ error: 'order_edit_branch_mismatch' });
  }
  const receivedAmount = Math.max(
    Number(order.amountPaid) || 0,
    (Array.isArray(order.partialPayments) ? order.partialPayments : [])
      .reduce((sum, payment) => sum + Math.max(0, Number(payment?.amount) || 0), 0),
  );
  if (order.paymentStatus === 'paid' || receivedAmount > 0) {
    return res.status(409).json({ error: 'order_edit_after_payment_requires_adjustment', current: order.status });
  }
  if (!canEditOrderBeforeKitchen(order)) {
    return res.status(409).json({ error: 'order_edit_locked', current: order.status, startedAt: order.startedAt || null });
  }
  const currentDiscount = parseOrderTomanAmount(order.discount ?? 0);
  if (currentDiscount === null) return res.status(409).json({ error: 'order_discount_state_invalid' });
  let requestedDiscount = null;
  if (req.body?.discount !== undefined) {
    requestedDiscount = parseOrderTomanAmount(req.body.discount);
    if (requestedDiscount === null) {
      return res.status(400).json({ error: 'discount_invalid', message: 'مبلغ تخفیف باید عدد صحیح و معتبر باشد.' });
    }
  }
  if (requestedDiscount !== null && requestedDiscount > currentDiscount && !userCan(req.user, 'orders.manage')) {
    return res.status(403).json({ error: 'discount_not_allowed', message: 'اعمال یا افزایش تخفیف دستی فقط برای نقش مجاز امکان‌پذیر است.' });
  }

  const snapshot = orderInventorySnapshot();
  const mutationSnapshot = snapshotFinanceMutationState();
  const previous = {
    total: Number(order.total || 0),
    subtotal: Number(order.subtotal || 0),
    itemUnits: (order.items || []).reduce((sum, line) => sum + Number(line.qty || 0), 0),
    covers: Number(order.covers) || 1,
  };
  const existingMenuIds = new Set((order.items || []).map((line) => Number(line.menuItemId)));
  const existingComplementIds = new Set((order.items || []).flatMap((line) => line.complements || []).map((entry) => Number(entry.id || entry.complementId)));

  // Put the order's reservation back temporarily so unchanged items remain
  // valid even when this order consumed the last tracked unit.
  adjustOrderInventory(order.items, 1, order.branchId);
  const normalized = orderLinesFromRequest(req.body?.items, {
    allowMenuItemIds: existingMenuIds,
    allowComplementIds: existingComplementIds,
    branchId: order.branchId,
    excludeInventoryReservationOrderId: order.id,
  });
  if (normalized.error) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json(normalized);
  }
  const sendToKitchen = req.body?.sendToKitchen === true;
  const waiterValidation = sendToKitchen
    ? validateWaiterKitchenSend(order, req.body?.items, { canonicalLines: normalized.lines })
    : validateWaiterOrderEdit(order, req.body?.items, { canonicalLines: normalized.lines });
  if (!waiterValidation.ok) {
    restoreOrderInventorySnapshot(snapshot);
    const conflictErrors = new Set([
      'invoice_closed', 'order_edit_locked', 'order_edit_payment_locked',
      'kitchen_send_locked', 'payment_not_confirmed',
    ]);
    return res.status(conflictErrors.has(waiterValidation.error) ? 409 : 400).json({
      error: waiterValidation.error,
      message: waiterValidation.error === 'payment_not_confirmed'
        ? 'وضعیت پرداخت سفارش تأیید نشده است؛ ابتدا اطلاعات فاکتور را بررسی کنید.'
        : 'اطلاعات سفارش با وضعیت فعلی فاکتور یا اقلام معتبر منو سازگار نیست؛ فاکتور را بازبینی کنید.',
      ...(waiterValidation.index === undefined ? {} : { index: waiterValidation.index }),
    });
  }
  if (sendToKitchen && !normalized.lines.some((line) => line.courseStatus === 'fired')) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'kitchen_course_empty', message: 'برای ارسال سفارش، دست‌کم یک مرحله باید به آشپزخانه فرستاده شود.' });
  }

  const inventoryReservationSnapshot = financeV2.buildOrderInventoryReservationSnapshot(
    db, normalized.lines, order.branchId, order.createdAt || new Date().toISOString(),
  );
  if (!inventoryReservationSnapshot.ok) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(409).json({
      error: 'inventory_reservation_unavailable',
      message: 'رزرو مواد اولیهٔ سفارش قابل به‌روزرسانی نیست؛ موجودی و دستور تهیه را بررسی کنید.',
      details: inventoryReservationSnapshot.issues,
    });
  }

  const rawCovers = req.body?.covers === undefined
    ? Math.max(Number(order.covers) || 1, highestAssignedSeat(order.items))
    : Number(normalizeDigits(String(req.body.covers)).replace(/[^0-9]/g, ''));
  const coverValidation = validateCoversForItems(rawCovers, normalized.lines);
  if (!coverValidation.ok && coverValidation.error === 'covers_invalid') {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'covers_invalid', message: 'تعداد مهمان باید بین ۱ تا ۹۹ نفر باشد.' });
  }
  if (!coverValidation.ok) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'seat_exceeds_covers', message: 'تعداد مهمان نمی‌تواند از شمارهٔ صندلی تخصیص‌یافته کمتر باشد.' });
  }

  const deliveryFee = parseOrderTomanAmount(order.deliveryFee ?? 0);
  if (deliveryFee === null) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(409).json({ error: 'order_delivery_fee_invalid' });
  }
  const discount = requestedDiscount === null ? Math.min(normalized.subtotal, currentDiscount) : requestedDiscount;
  if (discount > normalized.subtotal) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'discount_exceeds_subtotal', message: 'تخفیف نمی‌تواند از جمع اقلام بیشتر باشد.' });
  }
  const nextTotal = normalized.subtotal + deliveryFee - discount;
  if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'order_amount_unsafe' });
  }
  const amountPaid = Math.max(0, Number(order.amountPaid || (order.paymentStatus === 'paid' ? order.total : 0)) || 0);
  if (nextTotal < amountPaid) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(409).json({ error: 'order_edit_refund_required', amountPaid, nextTotal });
  }
  const nextName = String(req.body?.name ?? order.name ?? '').trim().slice(0, 100);
  const nextPhone = normalizeDigits(req.body?.phone ?? order.phone ?? '').trim().slice(0, 24);
  const nextNote = String(req.body?.note ?? order.note ?? '').trim().slice(0, 240);
  if (nextPhone && !PHONE_RE.test(nextPhone)) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });
  }

  adjustOrderInventory(normalized.lines, -1, order.branchId);
  order.items = normalized.lines;
  order.inventoryReservationSnapshot = inventoryReservationSnapshot;
  order.subtotal = normalized.subtotal;
  order.discount = discount;
  order.total = nextTotal;
  order.covers = rawCovers;
  order.amountPaid = amountPaid;
  order.paymentStatus = amountPaid >= nextTotal && nextTotal > 0 ? 'paid' : amountPaid > 0 ? 'partial' : (order.paymentStatus === 'pending' ? 'pending' : 'unpaid');
  order.name = nextName;
  order.phone = nextPhone;
  order.note = nextNote;
  order.editedAt = new Date().toISOString();
  order.editedBy = { phone: req.user.phone, role: effectiveRole(req.user), name: req.user.name || '' };
  order.editRevision = Math.max(0, Number(order.editRevision) || 0) + 1;
  order.balanceDue = Math.max(0, nextTotal - amountPaid);
  order.editHistory = Array.isArray(order.editHistory) ? order.editHistory : [];
  order.editHistory.push({ at: order.editedAt, by: order.editedBy, before: previous, after: { total: nextTotal, subtotal: normalized.subtotal, covers: rawCovers, itemUnits: normalized.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0) } });
  order.editHistory = order.editHistory.slice(-30);

  if (sendToKitchen && order.status === 'pay_at_cashier' && canTransitionOrder(order, 'sent_to_kitchen')) {
    appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'waiter-pos' });
    recordAudit(req, 'order.sent_to_kitchen', 'order', order.id, { source: 'waiter-pos', paymentStatus: order.paymentStatus }, order.branchId);
  }

  recordAudit(req, 'order.edited_before_kitchen', 'order', order.id, {
    beforeTotal: previous.total,
    afterTotal: nextTotal,
    beforeItemUnits: previous.itemUnits,
    afterItemUnits: normalized.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    paymentStatus: order.paymentStatus,
  }, order.branchId);
  try {
    await persistFinanceMutation(mutationSnapshot, { bumpMenu: true });
  } catch (error) {
    restoreFinanceMutationState(mutationSnapshot);
    return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
  }
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, edited: true }); }
  catch (error) { console.error('[order-edit] post-commit event failed', error?.message || error); }
  res.json({ ok: true, order: operationalOrderResponse(order, req.user), editable: canEditOrderBeforeKitchen(order) });
};

moduleRuntime.registerHttpRoute('pos', 'patch-074', moduleRouteContext);
moduleRuntime.registerHttpRoute('floor', 'patch-075', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-076', moduleRouteContext);

function isSettlementRequestFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

const handleSettleOrder = async (req, res, forcedTargetId) => {
  const persistenceReadiness = settlementPersistenceGate.check({
    postgresEnabled: stateStore.enabled,
    postgresRequired: stateStore.required,
  });
  if (!persistenceReadiness.ok) {
    return res.status(persistenceReadiness.status).json({ error: persistenceReadiness.code, message: persistenceReadiness.message });
  }
  const targetId = forcedTargetId !== undefined ? forcedTargetId : Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branchId = persistedOrderBranchId(order);
  if (!branchId) return res.status(409).json({ error: 'order_branch_unresolved', message: 'شعبهٔ ثبت‌شدهٔ سفارش معتبر نیست؛ تسویه تا تطبیق شعبه انجام نمی‌شود.' });
  // The route's request body is optional, so requireCapability cannot infer
  // the branch from it. Resolve access from the order itself before even
  // returning an idempotent response; otherwise a scoped cashier/manager
  // could settle or inspect a paid order belonging to another branch.
  try {
    assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (effectiveRole(req.user) === 'waiter') {
    const serviceTiming = validateWaiterSettlementTiming(order);
    if (!serviceTiming.ok) {
      return res.status(409).json({
        error: serviceTiming.error,
        message: 'گارسون فقط پس از ثبت تحویل سفارش به میز می‌تواند تسویه را انجام دهد؛ برای تسویهٔ زودتر، فاکتور را به صندوق بسپارید.',
      });
    }
  }
  const tenderValue = req.body?.tender;
  if (typeof tenderValue !== 'string' || !tenderValue.trim()) {
    return res.status(400).json({ error: 'settlement_tender_required', message: 'روش دریافت وجه را انتخاب کنید.' });
  }
  const tender = tenderValue.trim();
  if (tender === 'cash' && !userCan(req.user, 'cash.manage')) {
    return res.status(403).json({ error: 'cash_collection_forbidden', message: 'دریافت وجه نقد فقط برای کاربر دارای دسترسی صندوق مجاز است.' });
  }
  const rawPaymentAmount = req.body?.paymentAmount == null ? null : req.body.paymentAmount;
  const rawAmountTendered = req.body?.amountTendered == null ? null : req.body.amountTendered;
  let paymentReference;
  try { paymentReference = normalizeSettlementReference(req.body?.paymentReference); }
  catch (error) { return res.status(error.status || 400).json({ error: error.code || 'settlement_reference_invalid', message: error.message }); }
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'settlement_idempotency_required', message: 'برای ثبت پرداخت، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'settlement_idempotency_invalid', message: 'کلید یکتای پرداخت معتبر نیست.' });
  }
  const inFlightKey = idempotencyKey ? settlementLockKey(req, order, idempotencyKey, branchId) : null;
  const requestFingerprint = idempotencyKey ? checkoutIdempotencyFingerprint({
    orderId: order.id,
    branchId,
    tender,
    paymentAmount: rawPaymentAmount,
    amountTendered: rawAmountTendered,
    paymentReference,
  }, req.user) : null;
  const existingPayment = idempotencyKey
    ? (Array.isArray(order.partialPayments) ? order.partialPayments : []).find((payment) => payment.idempotencyKey === idempotencyKey)
    : null;
  if (existingPayment) {
    if (!isSettlementRequestFingerprint(existingPayment.requestFingerprint)) {
      return res.status(409).json({
        error: 'idempotency_replay_unavailable',
        message: 'پرداخت قبلی اثرانگشت معتبر ندارد؛ برای جلوگیری از دریافت تکراری، رسید و وضعیت صندوق را تطبیق دهید و پرداخت را دوباره ثبت نکنید.',
      });
    }
    if (existingPayment.requestFingerprint && existingPayment.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({ error: 'idempotency_key_conflict', message: 'این کلید پرداخت پیش‌تر با مبلغ یا روش دیگری استفاده شده است.' });
    }
    const pending = settlementInFlight.get(inFlightKey);
    if (pending) {
      const outcome = await pending;
      if (!outcome.ok) return res.status(outcome.status || 503).json({ error: outcome.error || 'finance_persistence_failed', message: outcome.message });
    }
    return res.json({
      ok: true,
      idempotent: true,
      order: operationalOrderResponse(order, req.user),
      payment: operationalPaymentResponse(existingPayment, req.user),
    });
  }
  if (order.paymentStatus === 'paid') {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }
  if (order.paymentStatus === 'unknown') {
    return res.status(409).json({ error: 'payment_status_reconciliation_required', message: 'وضعیت پرداخت این سفارش قابل‌تأیید نیست؛ پیش از دریافت دوباره، سابقهٔ مالی را تطبیق دهید.' });
  }
  if (!canSettleOrder(order)) {
    return res.status(409).json({ error: 'order_not_payable', current: order.status });
  }
  // Only accept tenders backed by an actual local settlement path. Card
  // processing, gift cards, and stored cards are not connected providers;
  // they must never be marked paid merely because a client named them.
  if (!['cash', 'manual_card', 'wallet'].includes(tender)) return res.status(400).json({ error: 'tender_invalid', message: 'این روش پرداخت در این سامانه فعال یا متصل نیست.' });
  if (tender === 'manual_card' && !paymentReference) {
    return res.status(400).json({
      error: 'settlement_reference_required',
      message: 'کد پیگیری درج‌شده روی رسید کارت‌خوان برای ثبت دستی الزامی است.',
    });
  }
  const previousPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
  if (tender === 'manual_card' && paymentReference) {
    const incomingReference = settlementReferenceIdentity(paymentReference);
    const referenceAlreadyUsed = previousPayments.some((payment) => {
      try { return settlementReferenceIdentity(payment?.reference) === incomingReference; }
      catch { return false; }
    });
    if (referenceAlreadyUsed) {
      return res.status(409).json({
        error: 'settlement_reference_duplicate',
        message: 'این کد پیگیری قبلاً برای همین فاکتور ثبت شده است؛ رسیدهای پرداخت را تطبیق دهید.',
      });
    }
  }
  const amounts = resolveSettlementAmounts({
    total: order.total,
    amountPaid: order.amountPaid,
    payments: previousPayments,
    paymentAmount: req.body?.paymentAmount,
    amountTendered: req.body?.amountTendered,
    tender,
  });
  if (!amounts.ok) {
    const status = amounts.error === 'payment_amount_exceeds_due' ? 409 : 400;
    return res.status(status).json({
      error: amounts.error,
      ...(amounts.outstanding !== undefined ? { outstanding: amounts.outstanding } : {}),
      ...(amounts.minimum !== undefined ? { minimum: amounts.minimum } : {}),
    });
  }
  const { alreadyPaid, outstanding, requestedAmount, amountTendered } = amounts;
  if (!requestedAmount || !outstanding) {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }
  const drawer = tender === 'cash' ? activeCashSession(req.user, branchId) : null;
  if (tender === 'cash' && !drawer) return res.status(409).json({ error: 'cash_drawer_not_open' });
  if (drawer) {
    const currentDrawerTotals = cashSessionTotals(drawer);
    const projectedDrawerTotals = cashSessionTotals({
      ...drawer,
      movements: [{ type: 'sale', amount: requestedAmount }, ...(Array.isArray(drawer.movements) ? drawer.movements : [])],
    });
    if (!currentDrawerTotals || !projectedDrawerTotals) {
      return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق معتبر و قابل جمع‌بندی نیست؛ پیش از دریافت وجه آن را تطبیق دهید.' });
    }
  }

  // Snapshot before any tender-side mutation. Wallet payments update the
  // customer balance before the sale journal is attempted; a closed/missing
  // fiscal period or a durable-write failure must roll that debit back along
  // with the order and drawer projection.
  const snapshot = snapshotFinanceMutationState();
  let resolveSettlement;
  let settlementPromise;
  let settlementAuditEntry;
  try {
  if (tender === 'wallet') {
    if (!order.phone) return res.status(400).json({ error: 'شماره مشتری برای پرداخت از کیف پول الزامی است.' });
    const walletBal = walletEngine.getWalletBalance(db, order.phone);
    if (walletBal < requestedAmount) {
      return res.status(400).json({ error: 'موجودی کیف پول مشتری کافی نیست.', balance: walletBal, required: requestedAmount });
    }
    walletEngine.payFromWallet(db, {
      phone: order.phone,
      amountToman: requestedAmount,
      orderId: order.id,
      actor: req.user.phone || 'cashier',
    });
  }

  const paymentAt = new Date().toISOString();
  const payment = {
    id: nextId(previousPayments), tender, amount: requestedAmount,
    amountTendered, changeDue: tender === 'cash' ? Math.max(0, amountTendered - requestedAmount) : 0,
    ...(paymentReference ? { reference: paymentReference } : {}),
    ...(tender === 'cash' && drawer ? { cashSessionId: drawer.id } : {}),
    at: paymentAt, by: req.user.phone,
    ...(idempotencyKey ? { idempotencyKey, requestFingerprint } : {}),
  };
  order.partialPayments = previousPayments;
  order.partialPayments.push(payment);
  order.amountPaid = alreadyPaid + requestedAmount;
  const fullyPaid = order.amountPaid >= Number(order.total || 0);
  order.paymentStatus = fullyPaid ? 'paid' : 'partial';
  if (fullyPaid) {
    const nextStatus = nextOrderStatusAfterPayment(order);
    if (nextStatus && canTransitionOrder(order, nextStatus)) {
      appendOrderStatus(order, nextStatus, req.user, { source: 'cashier', tender });
    } else if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery'
        && ['pending', 'pending_cashier'].includes(String(order.status || ''))) {
      // Preserve the legacy wallet-intent states for non-delivery orders.
      appendOrderStatus(order, 'paid', req.user, { source: 'cashier', tender });
    }
  }
  order.paymentTender = tender;
  order.paymentTenders = [...new Set(order.partialPayments.map((entry) => entry.tender))];
  if (fullyPaid) order.paidAt = paymentAt;
  order.amountTendered = amountTendered;
  order.changeDue = payment.changeDue;
  if (drawer) {
    drawer.movements.unshift({
      id: nextId(drawer.movements),
      type: 'sale',
      amount: requestedAmount,
      orderId: order.id,
      note: `فروش سفارش ${order.orderNo || order.id}`,
      at: paymentAt,
      by: req.user.phone,
    });
  }
  const receiptFinanceResult = ['cash', 'manual_card'].includes(tender)
    ? financeV2.captureOrderPaymentReceipt(db, order, payment, {
      actor: req.user.phone,
      cashSessionId: drawer?.id || null,
    })
    : null;
  settlementAuditEntry = recordAudit(req, fullyPaid ? 'order.settled' : 'order.partial_payment', 'order', order.id, { tender, paymentAmount: requestedAmount, amountPaid: order.amountPaid, outstanding: Math.max(0, Number(order.total || 0) - order.amountPaid), amountTendered, changeDue: order.changeDue }, branchId, { deferAppend: true });
  const financeResult = fullyPaid
    ? financeV2.capturePaidOrder(db, order, { actor: req.user.phone, idempotencyKey: `order:${order.id}:payment:${order.paymentRevision || order.partialPayments.length}` })
    : null;
  if (fullyPaid) {
    try {
      accountingEngine.syncOrderSalesJournal(db, order);
    } catch (accErr) {
      console.error('[accounting] syncOrderSalesJournal note:', accErr.message);
    }
  }
  if (fullyPaid && (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted')) {
    const captureCode = financeResult?.event?.error?.code || 'finance_capture_blocked';
    throw Object.assign(new Error('پرداخت ثبت نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
      code: captureCode,
      status: 409,
      details: financeResult?.event?.error || null,
    });
  }
  if (idempotencyKey) {
    settlementPromise = new Promise((resolve) => { resolveSettlement = resolve; });
    settlementInFlight.set(inFlightKey, settlementPromise);
  }
  await persistFinanceMutation(snapshot);
  appendAuditAfterCommit(settlementAuditEntry);
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId, status: order.status }); }
  catch (eventError) { console.error('[settlement] post-commit event failed', eventError?.message || eventError); }
  const responsePayload = {
    ok: true,
    order: operationalOrderResponse(order, req.user),
    payment: operationalPaymentResponse(payment, req.user),
    drawer: drawer ? { session: drawer, totals: cashSessionTotals(drawer) } : null,
    ...(userCan(req.user, 'payments.manage') ? { finance: financeResult, financeReceipt: receiptFinanceResult } : {}),
  };
  resolveSettlement?.({ ok: true });
  if (inFlightKey) settlementInFlight.delete(inFlightKey);
  res.json(responsePayload);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    const failedKey = inFlightKey;
    if (settlementPromise) {
      // Resolve duplicate requests only after the original durable write has
      // either committed or rolled back; never acknowledge an in-memory debit.
      resolveSettlement?.({ ok: false, status: error.status || 503, error: error.code || error.message, message: error.message });
      if (failedKey) settlementInFlight.delete(failedKey);
    }
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
};

moduleRuntime.registerHttpRoute('pos', 'post-077', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-078', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'get-079', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'get-080', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'put-081', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-082', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-083', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-084', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'patch-085', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'get-086', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'patch-087', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'patch-088', moduleRouteContext);

// Walk-in reception is deliberately separate from timed reservation editing.
// A waiter may receive a phone number and later seat the guest, but cannot
// alter an online booking or claim a table without a server-side check.
function publicWaitlistEntry(entry) {
  return {
    ...entry,
    statusLabel: ({ waiting: 'در انتظار', called: 'در حال فراخوانی', seated: 'نشسته', left: 'خارج شد', cancelled: 'لغو شد' })[entry.status] || entry.status,
  };
}

function waitlistForBranch(branchId, includeHistory = true) {
  const entries = waitlist.listWaitlist(db.reservations || [], branchId, { includeTerminal: includeHistory, limit: 120 });
  let position = 0;
  return entries.map((entry) => publicWaitlistEntry({
    ...entry,
    position: waitlist.isActive(entry) && entry.status !== 'seated' ? ++position : null,
  }));
}

const waitlistMutationQueues = new Map();

async function serializeWaitlistMutation(branchId, operation) {
  const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
  const key = `${tenantId}:${Number(branchId)}`;
  const previous = waitlistMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  waitlistMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (waitlistMutationQueues.get(key) === current) waitlistMutationQueues.delete(key);
  }
}

moduleRuntime.registerHttpRoute('reservations', 'get-089', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'post-090', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'patch-091', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'patch-092', moduleRouteContext);

function allocateOrderSplitDiscount(discount, selectedSubtotal, remainingSubtotal) {
  const selected = Number(selectedSubtotal);
  const remaining = Number(remainingSubtotal);
  const gross = selected + remaining;
  const requestedDiscount = Number(discount);
  if (!Number.isSafeInteger(selected) || selected < 0
      || !Number.isSafeInteger(remaining) || remaining < 0
      || !Number.isSafeInteger(gross)
      || !Number.isSafeInteger(requestedDiscount) || requestedDiscount < 0) return null;
  const totalDiscount = Math.min(requestedDiscount, gross);
  const selectedDiscount = gross > 0
    ? Number((BigInt(totalDiscount) * BigInt(selected)) / BigInt(gross))
    : 0;
  return {
    selectedDiscount,
    remainingDiscount: totalDiscount - selectedDiscount,
  };
}

moduleRuntime.registerHttpRoute('floor', 'post-093', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'patch-094', moduleRouteContext);


function cleanDeliveryZone(input, current = {}) {
  const branch = resolveBranch(input.branchId ?? current.branchId);
  const parseNum = (v, fb) => {
    if (v == null) return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const s = String(v)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[,٬_\s]/g, '')
      .trim();
    const n = Number(s);
    return isNaN(n) ? fb : n;
  };
  return {
    id: current.id || nextId(db.deliveryZones),
    branchId: branch?.id || Number(current.branchId) || defaultBranch()?.id || 1,
    name: String(input.name ?? current.name ?? '').trim().slice(0, 100),
    active: typeof input.active === 'boolean' ? input.active : current.active !== false,
    minOrder: Math.max(0, Math.round(parseNum(input.minOrder ?? current.minOrder, 0))),
    fee: Math.max(0, Math.round(parseNum(input.fee ?? current.fee, 0))),
    etaMinutes: Math.max(0, Math.min(240, Math.round(parseNum(input.etaMinutes ?? current.etaMinutes, 0)))),
    sort: Math.max(0, Math.round(parseNum(input.sort ?? current.sort, 0))),
  };
}

moduleRuntime.registerHttpRoute('delivery', 'get-095', moduleRouteContext);

function rollbackAuditEntry(entry, auditLogWasPresent) {
  if (entry && Array.isArray(db.auditLog)) db.auditLog = db.auditLog.filter((candidate) => candidate !== entry);
  if (!auditLogWasPresent && Array.isArray(db.auditLog) && db.auditLog.length === 0) delete db.auditLog;
}

function respondAdminConfigPersistenceFailure(res, error, fallbackCode) {
  console.error('[admin-config] durable write failed', error?.message || error);
  return res.status(error?.status || 503).json({
    error: error?.code || fallbackCode,
    message: 'تغییر ذخیره نشد؛ دوباره تلاش کنید.',
  });
}

function validateAdminHoursTime(value) {
  if (typeof value !== 'string') return null;
  const normalized = normalizeDigits(value).trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : null;
}

moduleRuntime.registerHttpRoute('delivery', 'post-096', moduleRouteContext);

moduleRuntime.registerHttpRoute('delivery', 'patch-097', moduleRouteContext);

moduleRuntime.registerHttpRoute('delivery', 'delete-098', moduleRouteContext);

moduleRuntime.registerHttpRoute('payments', 'get-099', moduleRouteContext);

function maybeAwardOrderLoyalty(order) {
  if (!order) return;
  if (!order.loyaltyAwarded && db.loyalty?.enabled) {
  const phone = normalizeDigits(order.phone || '').trim();
  const user = PHONE_RE.test(phone)
    ? db.users.find((candidate) => candidate.phone === phone && effectiveRole(candidate) === 'user')
    : null;
  if (user) {
    const resolved = loyaltyEngine.resolveCustomerTier(db, user);
    let pts = loyaltyEngine.calculateOrderPointsEarned(db, order.total, resolved.tier);

    // Happy Hour multiplier
    const hh = campaignsEngine.checkHappyHourStatus(db);
    if (hh.active && hh.pointsMultiplier > 1.0) {
      pts = Math.round(pts * hh.pointsMultiplier);
    }

    if (pts > 0) {
      awardLoyaltyPoints(phone, pts, 'order', {
        orderId: order.id,
        total: order.total,
        tierId: resolved.tier.id,
        tierName: resolved.tier.name,
        multiplier: resolved.tier.multiplier,
        happyHour: hh.active,
      });
      order.loyaltyAwarded = true;
      order.loyaltyPoints = pts;
      order.loyaltyTier = resolved.tier.id;

      // Notification delivery is best-effort; an async SMS rejection must
      // never turn a committed service completion into a failed HTTP request.
      try {
        const userBal = walletEngine.getWalletBalance(db, phone);
        Promise.resolve(smsEngine.sendSms(db, {
          phone,
          name: order.name || user.name || '',
          templateKey: 'points_awarded',
          vars: {
            name: order.name || user.name || 'مشتری گرامی',
            points: pts,
            total_points: user.points,
            wallet_balance: userBal,
            tier: resolved.tier.name,
          },
          triggerType: 'event',
        })).catch(() => {});
      } catch (_) {}
    }
  }

  // Check and unlock referral rewards
  try {
    campaignsEngine.checkAndRewardReferralOnOrder(db, order, {
      walletTopup: (input) => campaignWalletTopupWithFinance(input, order.branchId, 'referral-system'),
    });
  } catch (e) {
    console.error('[referral-reward] order check failed:', e.message);
  }
  }

  // Behavioral milestone points are created only as part of a real order
  // completion transition. Reads of /api/loyalty/me are strictly read-only.
  if (!db.loyalty?.enabled || !loyaltyAchievements.isValidCompletedOrder(order)) return;
  const member = (db.users || []).find((candidate) => effectiveRole(candidate) === 'user'
    && loyaltyAchievements.orderBelongsToMember(order, candidate));
  if (!member || !member.phone) return;
  const memberKey = member.id !== undefined && member.id !== null
    ? `user:${String(member.id)}`
    : `phone:${loyaltyAchievements.normalizePhoneKey(member.phone)}`;
  if (!Array.isArray(db.loyaltyAchievementAwards)) db.loyaltyAchievementAwards = [];
  const linkedOrders = (db.orders || []).filter((candidate) => loyaltyAchievements.orderBelongsToMember(candidate, member));
  const achievements = loyaltyAchievements.getLoyaltyAchievements(db);
  const context = {
    menuItems: db.menuItems || [],
    branches: db.branches || [],
    fallbackTimeZone: db.settings?.businessTimeZone || db.settings?.timezone || loyaltyAchievements.FALLBACK_TIME_ZONE,
  };
  for (const achievement of achievements) {
    if (!achievement.enabled || achievement.rewardPoints <= 0) continue;
    const progress = loyaltyAchievements.evaluateAchievement(achievement, linkedOrders, context);
    if (!loyaltyAchievements.isRewardEligibleAtLaunch(achievement, progress, order.id)) continue;
    const awardKey = `${memberKey}:${achievement.id}`;
    loyaltyAchievements.recordAchievementAwardOnce(db.loyaltyAchievementAwards, {
      key: awardKey,
      memberKey,
      achievementId: achievement.id,
      orderId: order.id,
      points: achievement.rewardPoints,
    }, () => awardLoyaltyPoints(member.phone, achievement.rewardPoints, 'achievement', {
      achievementId: achievement.id,
      achievementName: achievement.name,
      memberKey,
      orderId: order.id,
      oneTime: true,
    }));
  }
}

moduleRuntime.registerHttpRoute('delivery', 'post-100', moduleRouteContext);

moduleRuntime.registerHttpRoute('delivery', 'post-101', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'patch-102', moduleRouteContext);

// Versioned endpoint for new clients: order progress follows the state machine;
// payment status is only changed by a verified settlement/payment command.
moduleRuntime.registerHttpRoute('platform_core', 'patch-103', moduleRouteContext);

/* ---- Kitchen Display System (KDS) ---- */
const KDS_STATIONS = Object.freeze([
  { id: 'expo', label: 'خروج سفارش' },
  { id: 'hot', label: 'خط گرم' },
  { id: 'cold', label: 'خط سرد' },
  { id: 'bar', label: 'بار' },
]);

const KDS_BAR_CATEGORY_IDS = new Set([7599, 14477, 7675, 7701, 7676]);
const KDS_COLD_CATEGORY_IDS = new Set([7560, 13581, 7697]);

function kdsStationForMenuItem(menuItem) {
  const categoryId = Number(menuItem?.categoryId || 0);
  if (KDS_BAR_CATEGORY_IDS.has(categoryId)) return 'bar';
  if (KDS_COLD_CATEGORY_IDS.has(categoryId)) return 'cold';
  return 'hot';
}

function ensureKdsState(order) {
  order.kds = order.kds && typeof order.kds === 'object' ? order.kds : {};
  order.kds.itemStates = order.kds.itemStates && typeof order.kds.itemStates === 'object' ? order.kds.itemStates : {};
  order.kds.priority = !!order.kds.priority;
  return order.kds;
}

function kdsLineKey(item, index) {
  return `${index}:${Number(item?.menuItemId || 0)}`;
}

function kitchenHeldCourseItems(order) {
  return (order.items || []).filter((item) => String(item.courseStatus || 'fired').toLowerCase() === 'hold');
}

function kitchenLines(order, { onlyHeld = false } = {}) {
  const kds = ensureKdsState(order);
  const categories = new Map((db.menuCategories || []).map((entry) => [Number(entry.id), entry]));
  const menu = new Map((db.menuItems || []).map((entry) => [Number(entry.id), entry]));
  const lines = [];
  (order.items || []).forEach((item, index) => {
    const isHeld = String(item.courseStatus || 'fired').toLowerCase() === 'hold';
    if (isHeld !== onlyHeld) return;
    const source = menu.get(Number(item.menuItemId)) || {};
    const key = kdsLineKey(item, index);
    const category = categories.get(Number(source.categoryId)) || {};
    lines.push({
      key,
      kind: 'item',
      name: item.name,
      qty: Math.max(1, Number(item.qty) || 1),
      station: kdsStationForMenuItem(source),
      categoryId: Number(source.categoryId) || null,
      categoryName: category.title || '',
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      note: item.note || '',
      seat: Number(item.seat) || 0,
      course: item.course || 'starters',
      courseStatus: isHeld ? 'hold' : item.courseStatus || 'fired',
      firedAt: item.firedAt || null,
      allergens: Array.isArray(source.allergens) ? source.allergens : [],
      completedAt: kds.itemStates[key]?.completedAt || null,
      completedBy: kds.itemStates[key]?.completedBy || null,
    });
    (item.complements || []).forEach((entry, complementIndex) => {
      const complementKey = `${key}:complement:${complementIndex}`;
      lines.push({
        key: complementKey,
        kind: 'complement',
        parentKey: key,
        parentName: item.name,
        name: entry.name,
        qty: Math.max(1, Number(entry.qty) || 1),
        station: 'bar',
        categoryId: null,
        categoryName: 'مکمل',
        modifiers: [],
        note: '',
        seat: Number(item.seat) || 0,
        course: item.course || 'starters',
        courseStatus: isHeld ? 'hold' : item.courseStatus || 'fired',
        firedAt: item.firedAt || null,
        allergens: [],
        completedAt: kds.itemStates[complementKey]?.completedAt || null,
        completedBy: kds.itemStates[complementKey]?.completedBy || null,
      });

    });
  });
  return lines;
}

function kitchenColumn(order) {
  if (order.status === 'preparing') return 'preparing';
  if (order.status === 'ready') return 'ready';
  return 'new';
}

function elapsedSecondsSince(timestamp, now = Date.now()) {
  const timestampMs = timestamp instanceof Date
    ? timestamp.getTime()
    : typeof timestamp === 'number'
      ? timestamp
      : Date.parse(String(timestamp || ''));
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
}

function isKdsPaymentStatusEligible(order) {
  const orderStatus = String(order?.status || '').trim().toLowerCase();
  const paymentStatus = String(paymentStatusFor(order) || '').trim().toLowerCase();
  if (!['sent_to_kitchen', 'preparing', 'ready', 'paid'].includes(orderStatus)) return false;
  if (!['unpaid', 'partial', 'failed', 'paid'].includes(paymentStatus)) return false;
  return orderStatus !== 'paid' || paymentStatus === 'paid';
}

function isKdsPaymentEligible(order) {
  return isKitchenOrderPaymentEligible(order, paymentStatusFor(order));
}

function summarizeKdsPaymentReview(orders, branchId) {
  const active = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready']);
  const summary = { blockedCount: 0, pendingCount: 0, unknownCount: 0, incompatibleCount: 0 };
  for (const order of Array.isArray(orders) ? orders : []) {
    if (Number(order?.branchId) !== Number(branchId) || !active.has(String(order?.status || '').trim().toLowerCase())) continue;
    if (isKdsPaymentStatusEligible(order)) continue;
    summary.blockedCount += 1;
    const paymentStatus = String(paymentStatusFor(order) || '').trim().toLowerCase();
    if (paymentStatus === 'pending') summary.pendingCount += 1;
    else if (paymentStatus === 'unknown' || !paymentStatus) summary.unknownCount += 1;
    else summary.incompatibleCount += 1;
  }
  return summary;
}

function kitchenTicket(order, now = Date.now()) {
  const kds = ensureKdsState(order);
  const lines = kitchenLines(order);
  const heldCourseItems = kitchenLines(order, { onlyHeld: true });
  const ageSec = elapsedSecondsSince(order.createdAt, now);
  const prepAgeSec = order.startedAt ? elapsedSecondsSince(order.startedAt, now) : 0;
  return {
    ...order,
    items: lines,
    heldCourseItems,
    column: kitchenColumn(order),
    ageSec,
    ageKnown: ageSec !== null,
    prepAgeSec,
    prepAgeKnown: prepAgeSec !== null,
    kds: {
      priority: kds.priority,
      priorityAt: kds.priorityAt || null,
      completedAt: kds.completedAt || null,
    },
  };
}

function kdsPerformance(orders, now = Date.now()) {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const durations = orders
    .filter((order) => order.startedAt && order.readyAt && new Date(order.readyAt).getTime() >= dayAgo)
    .map((order) => Math.max(0, Math.floor((new Date(order.readyAt).getTime() - new Date(order.startedAt).getTime()) / 1000)))
    .filter((value) => value > 0 && value < 6 * 60 * 60)
    .sort((a, b) => a - b);
  const averagePrepSec = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
  const p90PrepSec = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * .9))] : 0;
  return { averagePrepSec, p90PrepSec, completedToday: durations.length };
}

function requestedKdsBranch(req) {
  const raw = req.query?.branchId ?? req.body?.branchId;
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  if (raw == null || raw === '') {
    if (allowedBranchIds !== null) {
      if (!allowedBranchIds.length) return null;
      const preferred = defaultBranch();
      return preferred && allowedBranchIds.includes(Number(preferred.id))
        ? preferred.id : allowedBranchIds[0];
    }
    return defaultBranch()?.id || null;
  }
  const id = Number(raw);
  const branch = Number.isFinite(id) ? (db.branches || []).find((entry) => Number(entry.id) === id && entry.active !== false) : null;
  if (!branch || (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branch.id)))) return null;
  return branch.id;
}

function kdsIdempotent(order) {
  return { ok: true, idempotent: true, order: kitchenTicket(order) };
}

function kdsMenuAvailabilityPayload(item, branchId) {
  const inventory = financeV2.menuItemAvailability(db, item.id, branchId);
  const override = menuAvailabilityOverride(db, item.id, branchId);
  const inventoryBlocked = (typeof item.stock === 'number' && item.stock <= 0)
    || (db.settings?.enforceInventoryStock === true && inventory?.tracked === true && inventory.available !== true);
  const manualAvailable = menuItemAvailableForBranch(db, item, branchId);
  const globallyAvailable = item.available !== false;
  return {
    id: item.id,
    name: item.name,
    available: manualAvailable && !inventoryBlocked,
    manualAvailable,
    globallyAvailable,
    inventoryBlocked,
    branchOverride: override.ok ? override.override?.available ?? null : null,
    station: kdsStationForMenuItem(item),
    categoryName: (db.menuCategories || []).find((entry) => Number(entry.id) === Number(item.categoryId))?.title || '',
  };
}

moduleRuntime.registerHttpRoute('kds', 'get-104', moduleRouteContext);

moduleRuntime.registerHttpRoute('kds', 'patch-105', moduleRouteContext);

moduleRuntime.registerHttpRoute('kds', 'patch-106', moduleRouteContext);

/* ---- Call waiter (فراخوان گارسون) ---- */
moduleRuntime.registerHttpRoute('floor', 'post-107', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'post-108', moduleRouteContext);



moduleRuntime.registerHttpRoute('kds', 'get-109', moduleRouteContext);

moduleRuntime.registerHttpRoute('kds', 'patch-110', moduleRouteContext);

// --- FAQ ---
moduleRuntime.registerHttpRoute('website_brand', 'post-111', moduleRouteContext);
moduleRuntime.registerHttpRoute('website_brand', 'put-112', moduleRouteContext);
moduleRuntime.registerHttpRoute('website_brand', 'delete-113', moduleRouteContext);
moduleRuntime.registerHttpRoute('website_brand', 'put-114', moduleRouteContext);

// --- admin: users & roles ---
moduleRuntime.registerHttpRoute('platform_core', 'get-115', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-116', moduleRouteContext);

const STAFF_BRANCH_ROLES = new Set(['manager', 'accountant', 'cashier', 'waiter', 'kitchen']);
const USER_ROLE_MAP = Object.freeze({ admin: 'owner', user: 'guest', owner: 'owner', manager: 'manager', accountant: 'accountant', cashier: 'cashier', waiter: 'waiter', kitchen: 'kitchen', guest: 'guest' });

function requestedBranchAssignments(body = {}, existingUser = null) {
  let rawIds;
  if (Array.isArray(body.allowedBranchIds)) rawIds = body.allowedBranchIds;
  else if (Object.prototype.hasOwnProperty.call(body, 'allowedBranchIds')) rawIds = [];
  else if (Object.prototype.hasOwnProperty.call(body, 'branchId')) rawIds = body.branchId == null || body.branchId === '' ? [] : [body.branchId];
  else if (Array.isArray(existingUser?.allowedBranchIds)) rawIds = existingUser.allowedBranchIds;
  else if (existingUser?.branchId != null && existingUser.branchId !== '') rawIds = [existingUser.branchId];
  else rawIds = [];

  const parsed = rawIds.map((value) => {
    const digits = normalizeDigits(String(value)).trim();
    const id = Number(digits);
    return /^\d+$/.test(digits) && Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  if (parsed.some((id) => id == null)) {
    return { error: { status: 400, code: 'staff_branch_assignment_invalid', message: 'فهرست شعب شامل شناسهٔ نامعتبر است.' } };
  }
  return { ids: [...new Set(parsed)] };
}

function validateStaffBranchAssignments(actor, role, ids) {
  if (!Array.isArray(ids) || (STAFF_BRANCH_ROLES.has(role) && ids.length === 0)) {
    return { status: 400, code: 'staff_branch_assignment_required', message: 'برای کارمند حداقل یک شعبهٔ مجاز انتخاب کنید.' };
  }
  const activeBranchIds = new Set((db.branches || []).filter((branch) => branch.active !== false).map((branch) => Number(branch.id)));
  if (ids.some((id) => !activeBranchIds.has(Number(id)))) {
    return { status: 400, code: 'staff_branch_assignment_invalid', message: 'یکی از شعب انتخاب‌شده وجود ندارد یا غیرفعال است.' };
  }
  const actorScope = branchScopeForUser(actor, { role: effectiveRole(actor) });
  if (actorScope !== null && ids.some((id) => !actorScope.includes(Number(id)))) {
    return { status: 403, code: 'staff_branch_assignment_forbidden', message: 'فقط می‌توانید شعبه‌هایی را واگذار کنید که خودتان به آن‌ها دسترسی دارید.' };
  }
  return null;
}

moduleRuntime.registerHttpRoute('platform_core', 'post-117', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'patch-118', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'delete-119', moduleRouteContext);

// --- newsletter ---
moduleRuntime.registerHttpRoute('crm', 'post-120', moduleRouteContext);
moduleRuntime.registerHttpRoute('crm', 'get-121', moduleRouteContext);

// --- admin: stats / uploads / settings ---
moduleRuntime.registerHttpRoute('platform_core', 'get-122', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-123', moduleRouteContext);

/* ---- Restaurant profile / hours / tables / promos / analytics ---- */
moduleRuntime.registerHttpRoute('website_brand', 'get-124', moduleRouteContext);
moduleRuntime.registerHttpRoute('website_brand', 'put-125', moduleRouteContext);
moduleRuntime.registerHttpRoute('website_brand', 'put-126', moduleRouteContext);

moduleRuntime.registerHttpRoute('floor', 'get-127', moduleRouteContext);
moduleRuntime.registerHttpRoute('floor', 'put-128', moduleRouteContext);
moduleRuntime.registerHttpRoute('floor', 'post-129', moduleRouteContext);
moduleRuntime.registerHttpRoute('floor', 'delete-130', moduleRouteContext);

// QR artwork is generated on the server so the admin can print/download a
// standards-compliant PNG without relying on a third-party image service.
moduleRuntime.registerHttpRoute('menu_qr', 'get-131', moduleRouteContext);

/* ---- Branches (چندشعبه) ---- */
moduleRuntime.registerHttpRoute('multi_branch', 'get-132', moduleRouteContext);

moduleRuntime.registerHttpRoute('multi_branch', 'get-133', moduleRouteContext);

moduleRuntime.registerHttpRoute('multi_branch', 'post-134', moduleRouteContext);

moduleRuntime.registerHttpRoute('multi_branch', 'put-135', moduleRouteContext);

moduleRuntime.registerHttpRoute('multi_branch', 'delete-136', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'get-137', moduleRouteContext);
moduleRuntime.registerHttpRoute('pos', 'post-138', moduleRouteContext);
moduleRuntime.registerHttpRoute('pos', 'patch-139', moduleRouteContext);
moduleRuntime.registerHttpRoute('pos', 'delete-140', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'get-141', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'post-142', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'patch-143', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'delete-144', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'post-145', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'post-146', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'post-147', moduleRouteContext);

/* Bulk price update — percent or absolute delta */
moduleRuntime.registerHttpRoute('platform_core', 'post-148', moduleRouteContext);

/* Public analytics beacon + admin analytics */
moduleRuntime.registerHttpRoute('platform_core', 'post-149', moduleRouteContext);

/* Debug-mode NDJSON ingest. Never expose this development aid in production. */
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/debug-log', (req, res) => {
    try {
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const line = JSON.stringify({
        sessionId: String(payload.sessionId || 'local').slice(0, 80),
        runId: String(payload.runId || 'local').slice(0, 80),
        hypothesisId: String(payload.hypothesisId || '').slice(0, 120),
        location: String(payload.location || '').slice(0, 200),
        message: String(payload.message || '').slice(0, 300),
        data: payload.data && typeof payload.data === 'object' ? payload.data : {},
        timestamp: Number(payload.timestamp) || Date.now(),
      });
      const logPath = path.join(ROOT, '.cursor', 'debug-local.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line.slice(0, 12000) + '\n');
    } catch (_) {}
    res.status(204).end();
  });
}

moduleRuntime.registerHttpRoute('analytics', 'get-150', moduleRouteContext);

/* Public restaurant info for site/footer if needed */
moduleRuntime.registerHttpRoute('website_brand', 'get-151', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'get-152', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'get-153', moduleRouteContext);

moduleRuntime.registerHttpRoute('website_brand', 'put-154', moduleRouteContext);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(UPLOADS, { recursive: true });
      cb(null, UPLOADS);
    },
    filename: (req, file, cb) => {
      const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extByMime[String(file.mimetype || '').toLowerCase()] || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('فقط تصویر JPEG/PNG/WebP/GIF مجاز است'), ok);
  },
});
moduleRuntime.registerHttpRoute('website_brand', 'post-155', moduleRouteContext);
moduleRuntime.registerHttpRoute('website_brand', 'get-156', moduleRouteContext);


moduleRuntime.registerHttpRoute('platform_core', 'get-157', moduleRouteContext);
moduleRuntime.registerHttpRoute('platform_core', 'put-158', moduleRouteContext);

/* ---- Loyalty club ---- */
moduleRuntime.registerHttpRoute('inventory', 'get-159', moduleRouteContext);

moduleRuntime.registerHttpRoute('inventory', 'post-160', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-161', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-162', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-163', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'put-164', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'put-165', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-166', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-167', moduleRouteContext);

// --- Membership QR Code for logged-in user ---
// Generates a real PNG QR code. The payload is a URL the cashier app
// can call directly to pull up this customer's loyalty profile.
moduleRuntime.registerHttpRoute('menu_qr', 'get-168', moduleRouteContext);



moduleRuntime.registerHttpRoute('crm', 'get-169', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-170', moduleRouteContext);

/* ---- Customer Digital Wallet (کیف پول و شارژ اعتباری) ---- */
moduleRuntime.registerHttpRoute('crm', 'get-171', moduleRouteContext);

// --- Wallet Topup Requests & Multi-Factor Approval Engine ---
db.walletTopupRequests = db.walletTopupRequests || [];

function generateShortTrackingCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// A wallet mutation is only successful when its Finance V2 deposit journal is
// posted in the same durable transaction. This keeps the customer balance,
// wallet ledger, request state, and official ledger from drifting apart.
async function applyWalletTopupWithFinance(req, input, mutate) {
  const snapshot = snapshotFinanceMutationState();
  try {
    let result = null;
    const finance = financeV2.captureWalletTopup(db, {
      branchId: input.branchId,
      amountToman: input.amountToman,
      bonusToman: input.bonusToman || 0,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      sourceId: input.sourceId || input.reference,
      phone: input.phone,
      packageId: input.packageId,
      actor: input.actor || req.user?.phone || 'system',
      idempotencyKey: input.idempotencyKey,
    }, {
      actor: input.actor || req.user?.phone || 'system',
      idempotencyKey: input.idempotencyKey,
      applyWallet: ({ event }) => {
        result = mutate();
        // Tag only the entries created by this mutation.  Looking at the
        // first two rows for a phone is not a safe identity boundary when a
        // concurrent/retried credit or a payment entry is already present.
        for (const entry of [result?.topupEntry, result?.bonusEntry].filter(Boolean)) {
          entry.meta = { ...(entry.meta || {}), financeEventId: event.id };
        }
        return result;
      },
    });
    if (finance.blocked || !finance.journalEntry) throw Object.assign(new Error('شارژ کیف پول تا ثبت سند مالی قابل تکمیل نیست.'), { code: finance.event?.error?.code || 'wallet_topup_finance_blocked', status: 409 });
    await persistFinanceMutation(snapshot);
    return { ...(finance.walletResult || result || {}), finance };
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    throw error;
  }
}

function campaignWalletTopupWithFinance(input, branchId, actor) {
  let result = null;
  const finance = financeV2.captureWalletTopup(db, {
    branchId, sourceId: input.reference, phone: input.phone,
    amountToman: input.amountToman, bonusToman: 0,
    paymentMethod: input.paymentMethod, reference: input.reference,
  }, {
    actor,
    applyWallet: ({ event }) => {
      result = walletEngine.topupWallet(db, input);
      for (const entry of [result?.topupEntry, result?.bonusEntry].filter(Boolean)) {
        entry.meta = { ...(entry.meta || {}), financeEventId: event.id };
      }
      return result;
    },
  });
  if (finance.blocked || !finance.journalEntry) throw Object.assign(new Error('پاداش کیف پول تا ثبت سند مالی قابل تکمیل نیست.'), { code: finance.event?.error?.code || 'wallet_bonus_finance_blocked', status: 409 });
  return result;
}

// 1. Create a Wallet Topup Request (Online Gateway or In-store Waiter/Cashier Approval)
moduleRuntime.registerHttpRoute('crm', 'post-172', moduleRouteContext);

// 2. Gateway Verification (Online payment gateway verification callback)
moduleRuntime.registerHttpRoute('crm', 'post-173', moduleRouteContext);

// 3. Staff Approval (Cashier or Waiter confirms and approves cash/POS topup)
moduleRuntime.registerHttpRoute('crm', 'post-174', moduleRouteContext);

// 4. Pending Topup Requests Query for Cashier & Waiter Panels
moduleRuntime.registerHttpRoute('crm', 'get-175', moduleRouteContext);

// 5. Customer Active Requests
moduleRuntime.registerHttpRoute('crm', 'get-176', moduleRouteContext);

// 6. Direct /api/wallet/topup Gateway or Staff Guard
moduleRuntime.registerHttpRoute('crm', 'post-177', moduleRouteContext);

moduleRuntime.registerHttpRoute('pos', 'post-178', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-179', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-180', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-181', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'put-182', moduleRouteContext);

/* ---- Automated Campaigns (کمپین‌های خودکار: هدیه تولد، کد معرف، ساعت شاد) ---- */
moduleRuntime.registerHttpRoute('crm', 'get-183', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-184', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-185', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-186', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-187', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-188', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'put-189', moduleRouteContext);

/* ---- Smart SMS & Retention Automation (پیامک‌های هوشمند و مدیریت ارتباط با مشتریان) ---- */
moduleRuntime.registerHttpRoute('crm', 'get-190', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-191', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'put-192', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-193', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-194', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-195', moduleRouteContext);

/* ---- Online reservations (رزرو میز) ---- */
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ACTIVE_RES_STATUSES = new Set(['pending', 'confirmed', 'seated']);
let reservationCreationTail = Promise.resolve();

async function serializeReservationCreation(operation) {
  const previous = reservationCreationTail;
  let release;
  reservationCreationTail = new Promise((resolve) => { release = resolve; });
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

function normalizeReservationDate(value) {
  const raw = normalizeDigits(String(value || '')).trim();
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year >= 1200 && year <= 1600) {
    if (month < 1 || month > 12 || day < 1 || day > shamsi.getJalaliMonthDays(year, month)) return null;
    try {
      return shamsi.toShamsiParts(`${year}/${month}/${day}`).isoDate;
    } catch (_) {
      return null;
    }
  }

  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate ? isoDate : null;
}

function reservationDateWithinWindow(dateStr, settings) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dayDelta = (Date.parse(`${dateStr}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86400000;
  const advanceDays = Math.max(1, Number(settings.advanceDays) || 21);
  return Number.isInteger(dayDelta) && dayDelta >= 0 && dayDelta <= advanceDays;
}

function reservationFingerprint({ branchId, date, time, partySize, name, phone, note }) {
  const canonical = JSON.stringify({ branchId, date, time, partySize, name, phone, note });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function reservationResponse(reservation, branch) {
  return {
    ...reservation,
    shamsiDate: shamsi.formatShamsiDate(reservation.date),
    shamsiDateLong: shamsi.formatShamsiDateLong(reservation.date),
    shamsiDateFull: shamsi.formatShamsiDateFull(reservation.date),
    branchName: branch?.name,
    restaurantName: db.restaurant?.name,
  };
}

function parseHm(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtHm(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function slotRangeMinutes(open, close) {
  let a = parseHm(open);
  let b = parseHm(close);
  if (b <= a) b += 24 * 60; // overnight
  return { a, b };
}
function listReservationSlots(branch, dateStr, partySize = 2) {
  const settings = db.reservationSettings || {};
  const slotMin = Math.max(15, Math.min(120, Number(settings.slotMinutes) || 30));
  const maxCovers = Math.max(1, Number(settings.maxCoversPerSlot) || 24);
  const maxParty = Math.max(1, Number(settings.maxParty) || 12);
  const party = Math.max(1, Math.min(maxParty, Number(partySize) || 2));
  const day = JS_DAY_TO_KEY[new Date(`${dateStr}T12:00:00`).getDay()];
  const hours = (branch?.hours || db.hours || {})[day];
  if (!hours || hours.closed) return { slots: [], closed: true, day };
  const { a, b } = slotRangeMinutes(hours.open, hours.close);
  const existing = (db.reservations || []).filter(
    (r) =>
      r.date === dateStr &&
      Number(r.branchId) === Number(branch.id) &&
      ACTIVE_RES_STATUSES.has(r.status) && !waitlist.isWaitlist(r)
  );
  const now = Date.now();
  const minAheadMs = Math.max(0, Number(settings.minHoursAhead) || 0) * 3600 * 1000;
  const slots = [];
  for (let t = a; t + slotMin <= b; t += slotMin) {
    const time = fmtHm(t % (24 * 60));
    const covers = existing.filter((r) => r.time === time).reduce((s, r) => s + (Number(r.partySize) || 0), 0);
    const slotDate = new Date(`${dateStr}T${time}:00`);
    const tooSoon = slotDate.getTime() - now < minAheadMs;
    const remaining = maxCovers - covers;
    slots.push({
      time,
      available: !tooSoon && remaining >= party,
      remaining,
      covers,
    });
  }
  return { slots, closed: false, day, open: hours.open, close: hours.close };
}

moduleRuntime.registerHttpRoute('reservations', 'get-196', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'get-197', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'post-198', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'get-199', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'patch-200', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'get-201', moduleRouteContext);

moduleRuntime.registerHttpRoute('reservations', 'put-202', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-203', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'put-204', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'post-205', moduleRouteContext);

// --- customer feedback / NPS ---
function feedbackNpsStats(list) {
  const scores = (list || []).map((f) => Number(f.score)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
  const promoters = scores.filter((s) => s >= 9).length;
  const passives = scores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null;
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { count: scores.length, promoters, passives, detractors, nps, avg };
}

moduleRuntime.registerHttpRoute('crm', 'get-206', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'post-207', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'get-208', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'put-209', moduleRouteContext);

moduleRuntime.registerHttpRoute('crm', 'patch-210', moduleRouteContext);

// ---- pages & static -----------------------------------------------------
moduleRuntime.registerHttpRoute('platform_core', 'get-211', moduleRouteContext);

const PAGES = {
  '/login': 'login.html',
  '/admin': 'admin.html',
  '/admin.html': 'admin.html',
  '/admin/cashier': 'role-panel.html',
  '/admin/waiter': 'role-panel.html',
  '/admin/kitchen': 'role-panel.html',
  '/profile': 'profile.html',
  '/menu': 'menu.html',
  '/order': 'order.html',
  '/order.html': 'order.html',
  '/menu-print': 'menu-print.html',
  '/reserve': 'reserve.html',
  '/about': 'about.html',
  '/feedback': 'feedback.html',
  '/cgu': 'cgu.html',
  '/mentions-legales': 'mentions-legales.html',
  '/politique-de-confidentialite': 'politique-de-confidentialite.html',
};

// Aliases for Operational Panels (POS, Waiter, KDS) and Checkout
moduleRuntime.registerHttpRoute('pos', 'get-212', moduleRouteContext);
moduleRuntime.registerHttpRoute('floor', 'get-213', moduleRouteContext);
moduleRuntime.registerHttpRoute('kds', 'get-214', moduleRouteContext);
moduleRuntime.registerHttpRoute('platform_core', 'get-215', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-216', moduleRouteContext);

// The installed app always revalidates its lifecycle files. Versioned code can
// remain immutable; media keeps a bounded window so admin updates stay fresh.
moduleRuntime.registerHttpRoute('platform_core', 'get-217', moduleRouteContext);

moduleRuntime.registerHttpRoute('platform_core', 'get-218', moduleRouteContext);

app.use((req, res, next) => {
  const pathname = String(req.path || '');
  if (pathname === '/admin.html' || /^\/(?:js\/admin(?:-|\.)|css\/admin(?:-|\.))/.test(pathname)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  } else if (/^\/uploads\//.test(pathname)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/^\/assets\/(?:fonts|images|audio)\//.test(pathname)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  } else if (/^\/assets\/menu\//.test(pathname)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  } else if (/^\/(?:js|css)\//.test(pathname) && req.query.v) {
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
  next();
});
app.use('/api', (req, res) => {
  res.status(404).json({
    ok: false,
    error: 'route_not_found',
    message: `مسیر ${req.method} ${req.originalUrl || req.path} در سرور یافت نشد.`,
    requestId: req.requestId,
  });
});

// Strict static asset security perimeter (blocks path traversal, source code, keys, and internal configs)
const FORBIDDEN_STATIC_PREFIXES = [
  '/modules',
  '/server',
  '/scripts',
  '/test',
  '/node_modules',
  '/backups',
  '/artifacts',
  '/docs',
  '/desktop',
  '/sites',
  '/storage',
  '/nginx',
  '/e2e',
  '/dist-desktop'
];

const FORBIDDEN_STATIC_EXTENSIONS = /\.(key|pem|crt|env|json|ya?ml|sql|log|enc|sh|ts|lock|bak|conf|ini|sqlite|db|md|config\.js)$/i;

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(req.path);
  } catch {
    return res.status(400).send('Bad Request');
  }

  // Prevent path traversal
  if (decodedPath.includes('..') || decodedPath.includes('\\')) {
    return res.status(403).send('Forbidden');
  }

  // Prevent hidden / dotfile access
  if (/(?:^|\/)\./.test(decodedPath)) {
    return res.status(404).send('Not Found');
  }

  // Prevent internal directory exposure
  const normalizedPath = path.posix.normalize(decodedPath);
  for (const prefix of FORBIDDEN_STATIC_PREFIXES) {
    if (normalizedPath === prefix || normalizedPath.startsWith(prefix + '/')) {
      return res.status(404).send('Not Found');
    }
  }

  // Prevent sensitive file extensions exposure
  if (FORBIDDEN_STATIC_EXTENSIONS.test(normalizedPath)) {
    return res.status(404).send('Not Found');
  }

  next();
});

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  try {
    const relative = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const selected = moduleRuntime.resolveFrontendAsset(relative, req.tenantContext?.moduleVersions || {});
    if (!selected) return next();
    res.setHeader('X-Westo-Module-Version', `${selected.moduleKey}@${selected.version}`);
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(selected.absolute);
  } catch (error) { return next(error); }
});
app.use(express.static(ROOT, { extensions: ['html'], etag: true, lastModified: true }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  const isApi = req.path && req.path.startsWith('/api/');
  const code = err.code || (status === 500 ? 'internal_server_error' : 'error');
  const message = (process.env.NODE_ENV === 'production' && status === 500)
    ? 'خطای غیرمنتظره در سرور رخ داد.'
    : (err.message || 'خطای غیرمنتظره در سرور رخ داد.');

  if (status >= 500) {
    console.error(`[unhandled_error] ${req.method} ${req.path} (${req.requestId}):`, err);
  }

  if (isApi || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(status).json({
      ok: false,
      error: code,
      message,
      requestId: req.requestId,
    });
  }
  return res.status(status).send(`<!DOCTYPE html><html><body><h1>خطای ${status}</h1><p>${message}</p></body></html>`);
});

let httpServer = null;

async function hydrateStateFromPostgres() {
  if (!stateStore.enabled) {
    if (stateStore.required) {
      const error = new Error('WESTO_POSTGRES_REQUIRED is enabled but PostgreSQL is unavailable.');
      error.code = 'postgres_required_unavailable';
      throw error;
    }
    return { source: 'json' };
  }
  const loaded = await stateStore.hydrate(db);
  const migrated = loaded.state ? migrateDb(loaded.state) : null;
  if (migrated && migrated !== db) {
    // Keep the exported reference stable for every route while promoting the
    // PostgreSQL snapshot to the active in-memory state.
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, migrated);
  }
  try {
    const recovery = await stateStore.loadActionableOrders();
    if (!recovery.available) {
      if (stateStore.required) {
        throw Object.assign(new Error('Normalized PostgreSQL order history is required for safe production startup.'), {
          code: recovery.reason || 'operational_order_store_missing', status: 503,
        });
      }
      console.warn('[orders] normalized order history is unavailable; only snapshot orders can be restored');
    } else {
      if (recovery.invalidRows && stateStore.required) {
        throw Object.assign(new Error(`Unable to restore ${recovery.invalidRows} malformed actionable order row(s).`), {
          code: 'operational_order_recovery_incomplete', status: 503,
        });
      }
      if (recovery.invalidRows) console.warn(`[orders] skipped ${recovery.invalidRows} malformed normalized order row(s)`);
      const mergedOrders = mergeActionableOrders(db.orders, recovery.orders);
      if (mergedOrders.restoredCount) {
        db.orders = mergedOrders.orders;
        console.warn(`[orders] restored ${mergedOrders.restoredCount} actionable order(s) omitted from the recent snapshot`);
      }
    }
  } catch (error) {
    if (stateStore.required) throw error;
    console.error('[orders] unable to reconcile actionable order history', error.message);
  }
  return loaded;
}

async function startServer() {
  if (httpServer) return httpServer;
  try {
    const loaded = await hydrateStateFromPostgres();
    console.log(`[storage] command center source: ${loaded.source}`);
  } catch (error) {
    // Shadow mode retains a deliberate recovery path. Cutover mode must fail
    // closed so a transient database issue cannot silently restore JSON as a
    // writable financial authority.
    if (stateStore.required) throw error;
    console.error('[postgres] startup hydration failed; using JSON snapshot', error.message);
  }
  rebuildProductsFromMenu();
  save();
  void neemBridge.flush();
  httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, (error) => {
      if (error) {
        reject(error);
        return;
      }
      console.log(`Westo server on http://${HOST}:${PORT}`);
      resolve(server);
    });
  });
  return httpServer;
}

async function shutdown(signal) {
  if (shutdown.running) return;
  shutdown.running = true;
  console.log(`[server] ${signal} received; shutting down gracefully`);
  try {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const pendingSaveWaiters = saveWaiters;
    saveWaiters = [];
    let shutdownPersistenceError = null;
    if (shouldWriteJsonState()) {
      try {
        const encoded = JSON.stringify(db, null, 2);
        const tmpPath = `${DB_PATH}.${process.pid}.shutdown.tmp`;
        fs.writeFileSync(tmpPath, encoded, { mode: 0o600 });
        fs.renameSync(tmpPath, DB_PATH);
      } catch (error) { shutdownPersistenceError = error; console.error('[storage] shutdown snapshot failed', error.message); }
    }
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    if (stateStore.enabled) {
      try { await stateStore.write(db); } catch (error) { shutdownPersistenceError = error; console.error('[postgres] shutdown flush failed', error.message); }
    }
    for (const pending of pendingSaveWaiters) {
      if (shutdownPersistenceError && pending.requireDurable) pending.reject(shutdownPersistenceError);
      else pending.resolve(!shutdownPersistenceError);
    }
    await stateStore.close();
    await tenantConnectionManager.close();
    await closeRuntimeControlDatabase();
  } finally { process.exit(0); }
}
['SIGTERM', 'SIGINT'].forEach((signal) => process.once(signal, () => shutdown(signal)));

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error('[server] unable to start', error);
    try { await stateStore.close(); } catch (closeError) { console.error('[postgres] startup cleanup failed', closeError.message); }
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
  db,
  stateStore,
  eventHub,
  tenantConfig: TENANT_CONFIG,
  tenantResolver,
  tenantConnectionManager,
  tenantRegistry,
  tenantInfrastructureEnabled: TENANT_INFRASTRUCTURE_ENABLED,
  commandCenterPayload,
  publicContentPayload,
  shouldWriteJsonState,
};
