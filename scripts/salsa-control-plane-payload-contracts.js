'use strict';

/**
 * Source-reviewed request contracts for the highest-risk Control Plane
 * mutations. The inventory still describes every route, but only these
 * schemas are promoted to OpenAPI requestBody entries. `additionalProperties`
 * stays true until the domain service explicitly rejects unknown fields.
 */

const string = (description, format) => ({ type: 'string', ...(format ? { format } : {}), description });
const number = (description) => ({ type: 'number', description });
const integer = (description) => ({ type: 'integer', description });
const boolean = (description) => ({ type: 'boolean', description });
const object = (description) => ({ type: 'object', description });
const array = (items, description) => ({ type: 'array', items, description });

function requestSchema(name, description, properties, required = []) {
  return {
    name,
    schema: {
      type: 'object',
      title: name,
      description,
      additionalProperties: true,
      properties,
      ...(required.length ? { required } : {})
    }
  };
}

const contracts = {};
const noBodyContracts = {};

function add(method, paths, contract) {
  for (const path of paths) contracts[`${method.toUpperCase()} ${path}`] = contract;
}

function addNoBody(method, paths, sourceEvidence) {
  for (const path of paths) {
    noBodyContracts[`${method.toUpperCase()} ${path}`] = {
      status: 'source_reviewed_no_body',
      sourceEvidence
    };
  }
}

// These actions consume only path/session/principal context in their handlers.
// Keeping them explicit prevents a missing requestBody from being mistaken for
// an unreviewed payload while preserving the distinction from a body schema.
addNoBody('POST', ['/api/control/auth/logout'], [
  { file: 'server/salsa/control-plane/routes/auth-routes.js', lines: '173-188', note: 'logout reads session token, IP and user-agent; request body is not consumed.' }
]);
addNoBody('POST', ['/api/control/auth/dev-session'], [
  { file: 'server/salsa/control-plane/routes/auth-routes.js', lines: '199-219', note: 'dev-session reads request IP and creates an ephemeral session; request body is not consumed.' }
]);
addNoBody('POST', ['/api/control/automation/outbox/{id}/retry'], [
  { file: 'server/salsa/control-plane/routes/automation-routes.js', lines: '182-193', note: 'retry uses path id and authenticated principal id; request body is not consumed.' }
]);
addNoBody('POST', [
  '/api/control/billing/subscriptions/{id}/cancel',
  '/api/control/billing/transactions/{id}/retry-activation'
], [
  { file: 'server/salsa/control-plane/routes/billing-routes.js', lines: '162-170,272-280', note: 'billing actions use path id and authenticated actor id; request body is not consumed.' }
]);
addNoBody('POST', [
  '/api/control/infra/domains/{id}/verify-dns',
  '/api/control/infra/domains/{id}/request-tls'
], [
  { file: 'server/salsa/control-plane/routes/infra-routes.js', lines: '62-79', note: 'domain verification/TLS actions use path id and authenticated principal id; request body is not consumed.' }
]);
addNoBody('POST', ['/api/control/policy/outbox/{id}/ack'], [
  { file: 'server/salsa/control-plane/routes/policy-routes.js', lines: '138-145', note: 'distribution ACK uses path id; request body is not consumed.' }
]);
addNoBody('POST', [
  '/api/control/data/sessions/{id}/revoke',
  '/api/control/data/support/sessions/{id}/end',
  '/api/control/data/support/sessions/{id}/revoke',
  '/api/control/sessions/{id}/revoke',
  '/api/control/support/sessions/{id}/end',
  '/api/control/support/sessions/{id}/revoke',
  '/api/control/support/support/sessions/{id}/end',
  '/api/control/support/support/sessions/{id}/revoke'
], [
  { file: 'server/salsa/control-plane/routes/support-routes.js', lines: '251-258', note: 'session revoke/end compatibility mounts use path id and authenticated principal id; request body is not consumed.' }
]);
addNoBody('POST', [
  '/api/control/jobs/{jobId}/retry',
  '/api/control/provision/{jobId}/retry',
  '/api/control/provisioning/jobs/{jobId}/retry',
  '/api/control/provisioning/provision/{jobId}/retry'
], [
  { file: 'server/salsa/control-plane/routes/tenant-provisioning-routes.js', lines: '149-159', note: 'provisioning retry compatibility mounts use path jobId and authenticated principal id; request body is not consumed.' }
]);

add('POST', ['/api/control/auth/bootstrap-owner'], requestSchema(
  'BootstrapOwnerRequest',
  'Initial platform owner bootstrap. The server rejects a second bootstrap.',
  {
    email: string('Owner email.', 'email'),
    fullName: string('Owner display name.'),
    password: string('Owner password.'),
    bootstrapSecret: string('Out-of-band bootstrap secret.')
  },
  ['email', 'fullName', 'password', 'bootstrapSecret']
));

add('POST', ['/api/control/auth/login'], requestSchema(
  'PlatformLoginRequest',
  'First step of platform login; a successful response creates an MFA challenge.',
  { email: string('Platform email.', 'email'), password: string('Platform password.') },
  ['email', 'password']
));

add('POST', ['/api/control/auth/mfa/verify'], requestSchema(
  'MfaVerifyRequest',
  'Completes a platform MFA challenge.',
  { mfaToken: string('Opaque MFA challenge token.'), totpCode: string('RFC 6238 one-time code.') },
  ['mfaToken', 'totpCode']
));

add('POST', ['/api/control/auth/mfa/recovery'], requestSchema(
  'MfaRecoveryRequest',
  'Consumes one platform recovery code for an MFA challenge.',
  { mfaToken: string('Opaque MFA challenge token.'), recoveryCode: string('Single-use recovery code.') },
  ['mfaToken', 'recoveryCode']
));

add('POST', ['/api/control/invitations/accept'], requestSchema(
  'InvitationAcceptRequest',
  'Accepts a tenant invitation and establishes the new owner password.',
  { rawToken: string('Opaque invitation token.'), newPassword: string('New owner password.') },
  ['rawToken', 'newPassword']
));

add('POST', ['/api/control/tenants'], requestSchema(
  'DraftTenantRequest',
  'Registers tenant metadata without provisioning an operational tenant database.',
  {
    tenantId: string('Stable tenant identifier.'),
    displayName: string('Tenant display name.'),
    planCode: string('Commercial plan code.'),
    cellId: string('Target cell identifier.'),
    canonicalDomain: string('Canonical tenant domain.', 'hostname'),
    metadata: object('Non-PII tenant metadata.')
  },
  ['tenantId', 'displayName']
));

add('POST', ['/api/control/provision', '/api/control/jobs'], requestSchema(
  'ProvisionTenantRequest',
  'Starts an idempotent zero-data tenant provisioning job.',
  {
    tenantId: string('Stable tenant identifier.'),
    displayName: string('Tenant display name.'),
    cellId: string('Target cell identifier.'),
    planCode: string('Commercial plan code.'),
    canonicalDomain: string('Canonical tenant domain.', 'hostname'),
    ownerEmail: string('Initial owner email.', 'email'),
    templateCode: string('Zero-data template code.'),
    idempotencyKey: string('Idempotency key; may also be supplied as the Idempotency-Key header.')
  },
  ['tenantId', 'displayName', 'ownerEmail']
));

add('POST', ['/api/control/billing/quotes'], requestSchema(
  'BillingQuoteRequest',
  'Calculates a quote without charging a payment provider.',
  {
    planCode: string('Commercial plan code.'),
    addonKeys: array(string('Addon key.'), 'Requested addon keys.'),
    billingCycle: string('Billing cycle code.'),
    extraBranches: integer('Additional branch count.'),
    extraDevices: integer('Additional device count.')
  }
));

add('POST', ['/api/control/billing/checkout'], requestSchema(
  'BillingCheckoutRequest',
  'Creates a durable payment checkout intent before a provider redirect.',
  {
    tenantId: string('Tenant being billed.'),
    idempotencyKey: string('Stable checkout idempotency key.'),
    planCode: string('Commercial plan code.'),
    addonKeys: array(string('Addon key.'), 'Requested addon keys.'),
    billingCycle: string('Billing cycle code.'),
    callbackUrl: string('Provider callback URL.', 'uri')
  },
  ['tenantId', 'idempotencyKey']
));

add('POST', ['/api/control/billing/verify'], requestSchema(
  'BillingVerifyRequest',
  'Verifies and settles a provider authority returned by the payment gateway.',
  { authority: string('Provider authority.'), addonKeys: array(string('Addon key.'), 'Addon keys.') },
  ['authority']
));

add('POST', ['/api/control/backups/manifests'], requestSchema(
  'BackupManifestRequest',
  'Creates an encrypted backup manifest and immutable artifacts.',
  {
    tenant_id: string('Tenant identifier.'),
    scope: string('Backup scope.'),
    epoch: integer('Tenant data epoch.'),
    db_content: string('Serialized database snapshot.'),
    files_content: string('Serialized file manifest.'),
    config_snapshot: object('Configuration snapshot.'),
    retention_tier: string('Retention tier.')
  },
  ['tenant_id']
));

add('POST', ['/api/control/backups/verify'], requestSchema(
  'BackupVerifyRequest',
  'Verifies a stored backup manifest and its artifacts.',
  { manifest_id: string('Backup manifest identifier.'), simulated_artifacts: object('Test-only artifact projection.') },
  ['manifest_id']
));

add('POST', ['/api/control/backups/restore-drill'], requestSchema(
  'RestoreDrillRequest',
  'Runs an isolated restore reconciliation drill for a target tenant.',
  { manifest_id: string('Backup manifest identifier.'), target_tenant_id: string('Isolated restore target tenant.') },
  ['manifest_id', 'target_tenant_id']
));

add('POST', ['/api/control/edge/pair'], requestSchema(
  'EdgePairRequest',
  'Pairs an Edge station with an initial lease.',
  {
    tenant_id: string('Tenant identifier.'),
    branch_id: string('Branch identifier.'),
    device_name: string('Human-readable device name.'),
    device_kind: string('Device kind.'),
    pairing_code: string('Out-of-band pairing code.')
  },
  ['tenant_id', 'branch_id', 'device_name']
));

add('POST', ['/api/control/edge/leases/renew'], requestSchema(
  'EdgeLeaseRenewRequest',
  'Renews a lease using the current lease token.',
  { device_id: string('Edge device identifier.'), tenant_id: string('Tenant identifier.'), current_lease_token: string('Current lease token.') },
  ['device_id', 'tenant_id', 'current_lease_token']
));

add('POST', ['/api/control/edge/sync'], requestSchema(
  'EdgeSyncRequest',
  'Submits an authenticated Edge batch for durable deduplicated sync.',
  { tenant_id: string('Tenant identifier.'), device_id: string('Edge device identifier.'), lease_token: string('Current lease token.'), batch: array(object('Edge event payload.'), 'Ordered Edge event batch.') },
  ['tenant_id', 'device_id', 'lease_token', 'batch']
));

add('POST', ['/api/control/integrations/westo/events'], requestSchema(
  'WestoBridgeEventRequest',
  'Signed WESTO-to-NEEM event envelope. The event idempotency key may be eventId or idempotencyKey.',
  {
    tenantId: string('Signed tenant identifier.'),
    eventId: string('Stable event identifier.'),
    idempotencyKey: string('Stable idempotency key.'),
    type: string('Event type.'),
    eventName: string('Compatibility event name.'),
    targetCell: string('Target cell identifier.'),
    payload: object('Domain event payload.')
  },
  ['tenantId']
));

add('POST', ['/api/control/audit/siem/export'], requestSchema(
  'SiemAuditExportRequest',
  'Exports the next durable audit batch to the configured HTTPS SIEM ingestion endpoint. The endpoint is fail-closed when not configured.',
  {
    limit: integer('Maximum audit events in one export batch; capped by the server.'),
    maxAttempts: integer('Maximum retry attempts for transient SIEM failures.')
  }
));

add('POST', ['/api/control/support/sessions/tenant-approval'], requestSchema(
  'SupportSessionTenantApprovalRequest',
  'Approves or rejects a pending platform support session with a one-time tenant approval token. Only an active tenant owner or manager may decide it.',
  {
    approvalToken: string('One-time approval token delivered to the tenant.'),
    tenantId: string('Tenant identifier bound to the approval token.'),
    decision: string('approve or reject.'),
    approverIdentityId: string('Active tenant owner or manager identity identifier.'),
    approverEmail: string('Approver email for the audit record.', 'email'),
    reason: string('Documented approval or rejection reason.')
  },
  ['approvalToken', 'tenantId', 'decision', 'approverIdentityId', 'reason']
));

add('POST', ['/api/control/releases'], requestSchema(
  'ReleaseCreateRequest',
  'Registers a signed release descriptor before wave execution.',
  {
    version: string('Semantic release version.'),
    manifest_checksum: string('Manifest SHA-256 checksum.'),
    git_commit_sha: string('Source commit identifier.'),
    min_compatible_edge_version: string('Minimum compatible Edge version.'),
    release_notes: string('Release notes.')
  },
  ['version', 'manifest_checksum', 'git_commit_sha']
));

add('POST', ['/api/control/releases/{version}/waves'], requestSchema(
  'ReleaseWaveRequest',
  'Starts a release cohort wave.',
  { wave_number: integer('Wave number.'), target_cohort: string('Cohort name.'), target_tenants: array(string('Tenant identifier.'), 'Explicit target tenants.') }
));

add('POST', ['/api/control/releases/{version}/evaluate-canary'], requestSchema(
  'ReleaseCanaryEvaluationRequest',
  'Evaluates canary telemetry before promotion.',
  { wave_id: string('Wave identifier.'), error_rate_pct: number('Observed error rate percentage.'), latency_p95_ms: number('Observed p95 latency in milliseconds.') },
  ['wave_id']
));

add('POST', ['/api/control/capacity/evaluate-bulkhead'], requestSchema(
  'CapacityBulkheadRequest',
  'Evaluates the local noisy-neighbour bulkhead model; this is not live telemetry.',
  { cell_id: string('Cell identifier.'), normal_tenant_rps: number('Normal tenant request rate.'), noisy_tenant_rps: number('Noisy tenant request rate.'), cell_max_connections: integer('Cell connection limit.') }
));

add('POST', ['/api/control/policy/grants'], requestSchema(
  'PolicyGrantRequest',
  'Issues a commercial feature grant for a tenant.',
  { tenantId: string('Tenant identifier.'), featureKey: string('Feature catalog key.'), grantKind: string('Grant kind.'), durationMonths: integer('Grant duration in months.'), metadata: object('Non-PII grant metadata.') },
  ['tenantId', 'featureKey']
));

add('POST', ['/api/control/policy/overrides'], requestSchema(
  'PolicyOverrideRequest',
  'Sets a per-user permission override with an audit reason.',
  { tenantId: string('Tenant identifier.'), userId: string('Tenant user identifier.'), permissionKey: string('Permission key.'), state: string('allow, deny, or inherit.'), decisionReason: string('Human-readable decision reason.') },
  ['tenantId', 'userId', 'permissionKey', 'state', 'decisionReason']
));

add('POST', ['/api/control/policy/publish'], requestSchema(
  'PolicyPublishRequest',
  'Publishes a tenant policy snapshot to a target cell.',
  { tenantId: string('Tenant identifier.'), targetCell: string('Target cell identifier.') },
  ['tenantId']
));

add('POST', ['/api/control/automation/outbox/enqueue'], requestSchema(
  'OutboxEnqueueRequest',
  'Enqueues an idempotent durable automation task.',
  { tenantId: string('Tenant identifier.'), targetCell: string('Target cell identifier.'), eventName: string('Task event name.'), payload: object('Task payload.'), idempotencyKey: string('Stable task idempotency key.'), delaySeconds: number('Optional delay in seconds.') },
  ['tenantId', 'eventName', 'idempotencyKey']
));

add('POST', ['/api/control/support/tickets'], requestSchema(
  'SupportTicketRequest',
  'Creates a support ticket with tenant scope and optional attachments.',
  { tenantId: string('Tenant identifier.'), tenant_id: string('Compatibility tenant identifier.'), title: string('Ticket title.'), subject: string('Compatibility subject.'), description: string('Ticket description.'), priority: string('Ticket priority.'), category: string('Ticket category.'), creatorEmail: string('Requester email.', 'email'), attachments: array(object('Attachment metadata.'), 'Attachment metadata.') },
  ['tenantId', 'description']
));

add('POST', ['/api/control/support/tickets/{id}/messages'], requestSchema(
  'SupportMessageRequest',
  'Adds a message to a support ticket conversation.',
  { messageBody: string('Message body.'), body: string('Compatibility message body.'), isInternal: boolean('Whether the message is internal.'), attachments: array(object('Attachment metadata.'), 'Attachment metadata.') },
  ['messageBody']
));

add('POST', ['/api/control/support/sessions'], requestSchema(
  'SupportSessionRequest',
  'Creates a time-bounded support view-as-user session.',
  { ticketId: string('Ticket identifier.'), tenantId: string('Tenant identifier.'), viewAsUserId: string('User to view as.'), sessionScope: string('read_only or scoped_write.'), reason: string('Human-readable access reason.'), durationMinutes: integer('Session duration in minutes.'), isWriteAllowed: boolean('Whether scoped writes are allowed.'), writeJustification: string('Required when writes are allowed.'), scopedActions: array(string('Allowed action key.'), 'Explicit scoped actions.') },
  ['ticketId', 'tenantId', 'reason']
));

add('POST', ['/api/control/support/sessions/validate'], requestSchema(
  'SupportSessionValidateRequest',
  'Validates an opaque support session token.',
  { rawToken: string('Opaque support session token.') },
  ['rawToken']
));

add('POST', ['/api/control/support/pii/encrypt'], requestSchema(
  'PiiEncryptRequest',
  'Encrypts a PII value using the active platform keyring.',
  { plaintext: string('Plaintext PII value.'), fieldType: string('PII field type.') },
  ['plaintext']
));

add('POST', ['/api/control/support/pii/reveal'], requestSchema(
  'PiiRevealRequest',
  'Reveals encrypted PII under an audited support reason.',
  { ciphertext: string('Encrypted PII ciphertext.'), reason: string('Human-readable reveal reason.'), tenantId: string('Tenant identifier.') },
  ['ciphertext', 'reason', 'tenantId']
));

add('POST', ['/api/control/identities/invite'], requestSchema(
  'IdentityInviteRequest',
  'Invites a tenant member with role and branch scope.',
  { tenantId: string('Tenant identifier.'), email: string('Invitee email.', 'email'), displayName: string('Invitee display name.'), phone: string('Invitee phone.'), role: string('Tenant role.'), branchScope: string('Branch scope.'), metadata: object('Non-PII member metadata.') },
  ['tenantId', 'email', 'displayName']
));

add('POST', ['/api/control/infra/domains'], requestSchema(
  'DomainRegistrationRequest',
  'Registers a tenant domain before DNS verification and TLS issuance.',
  { tenantId: string('Tenant identifier.'), domainName: string('Domain name.', 'hostname'), domainKind: string('Domain kind.'), brandConfig: object('Brand configuration.') },
  ['tenantId', 'domainName']
));

add('POST', ['/api/control/billing/quotas/{tenantId}/reserve'], requestSchema(
  'QuotaReserveRequest',
  'Reserves a quota unit atomically for a tenant.',
  { resourceType: string('Quota resource type.'), quantity: number('Reservation quantity.') },
  ['resourceType']
));

add('POST', ['/api/control/billing/plans/custom'], requestSchema(
  'CustomBillingPlanRequest',
  'Creates a bespoke tenant billing plan. The pricing service supplies defaults for optional limits and feature lists.',
  {
    tenantId: string('Tenant identifier.'),
    nameFa: string('Human-readable custom plan name.'),
    basePriceMonthlyRials: number('Monthly base price in Iranian rials.'),
    includedBranches: integer('Included branch limit.'),
    includedDevices: integer('Included device limit.'),
    includedUsers: integer('Included user limit.'),
    includedFeatures: array(string('Feature catalog key.'), 'Included feature keys.'),
    quotas: object('Optional quota overrides for orders, storage, SMS, and related limits.')
  },
  ['tenantId', 'nameFa']
));

add('PUT', ['/api/control/billing/quotas/{tenantId}'], requestSchema(
  'QuotaUpdateRequest',
  'Updates tenant quota limits while preserving current resource usage. Either short names or max-prefixed names may be supplied.',
  {
    branches: integer('Maximum branches; -1 means unlimited.'),
    devices: integer('Maximum devices; -1 means unlimited.'),
    users: integer('Maximum users; -1 means unlimited.'),
    orders: integer('Maximum monthly orders; -1 means unlimited.'),
    storageMb: integer('Maximum storage in MB; -1 means unlimited.'),
    smsCredits: integer('Maximum monthly SMS credits; -1 means unlimited.'),
    maxBranches: integer('Compatibility alias for branches.'),
    maxDevices: integer('Compatibility alias for devices.'),
    maxUsers: integer('Compatibility alias for users.'),
    maxOrders: integer('Compatibility alias for orders.'),
    maxStorageMb: integer('Compatibility alias for storageMb.'),
    maxSms: integer('Compatibility alias for smsCredits.')
  }
));

add('POST', ['/api/control/policy/evaluate'], requestSchema(
  'PolicyEvaluateRequest',
  'Evaluates the five-clause policy decision. The route accepts either complete tenant and identity objects or simulator aliases that it normalizes before evaluation.',
  {
    tenant: object('Tenant context with id, status, and displayName.'),
    identity: object('Identity context with id, role, status, and name.'),
    permissionKey: string('Permission key to evaluate.'),
    featureKey: string('Optional commercial feature key.'),
    tenantId: string('Simulator tenant identifier.'),
    tenantStatus: string('Simulator tenant status.'),
    tenantName: string('Simulator tenant display name.'),
    actor: object('Simulator actor identity.'),
    userId: string('Simulator user identifier.'),
    actorRole: string('Simulator actor role.'),
    role: string('Compatibility simulator role alias.'),
    userStatus: string('Simulator user status.'),
    userName: string('Simulator user display name.')
  }
));

// -----------------------------------------------------------------------------
// D19: remaining handler-level contracts promoted after source review.
// These routes share compatibility aliases, so required fields are only added
// where the handler checks the exact canonical key. Alias alternatives remain
// documented properties with additionalProperties=true for compatibility.
// -----------------------------------------------------------------------------

add('POST', ['/api/control/{tenantId}/invitations', '/api/control/provisioning/{tenantId}/invitations'], requestSchema(
  'TenantInvitationRequest',
  'Creates a tenant invitation. The handler requires email and accepts optional phone, role and expiryHours.',
  { email: string('Invitee email.', 'email'), phone: string('Invitee phone.'), role: string('Tenant membership role.'), expiryHours: integer('Invitation lifetime in hours.') },
  ['email']
));

add('POST', ['/api/control/automation/incidents/{id}/resolve'], requestSchema(
  'AutomationIncidentResolveRequest',
  'Resolves an operational automation incident with optional operator notes.',
  { resolutionNotes: string('Operator resolution notes.') }
));

add('POST', ['/api/control/automation/outbox/{id}/cancel'], requestSchema(
  'AutomationOutboxCancelRequest',
  'Cancels a durable outbox task with an optional reason.',
  { reason: string('Cancellation reason.') }
));

add('POST', ['/api/control/automation/rules'], requestSchema(
  'AutomationRuleRequest',
  'Creates or updates a versioned automation rule. triggerKind/trigger_type are compatibility aliases; conditions/condition, actionPayload/action and scheduleWindow/schedule_window are also aliases.',
  {
    id: string('Existing rule identifier for an update.'),
    rule_id: string('Compatibility alias for id.'),
    name: string('Rule name.'),
    description: string('Rule description.'),
    triggerKind: string('Rule trigger kind.'),
    trigger_type: string('Compatibility alias for triggerKind.'),
    conditions: object('Rule condition object.'),
    condition: object('Compatibility alias for conditions.'),
    actionPayload: object('Rule action payload.'),
    action: object('Compatibility alias for actionPayload.'),
    scheduleWindow: object('Schedule window object.'),
    schedule_window: object('Compatibility alias for scheduleWindow.'),
    scheduleCron: string('Cron schedule expression.'),
    schedule_cron: string('Compatibility alias for scheduleCron.'),
    priority: integer('Rule priority; defaults to 10.')
  },
  ['name']
));

add('POST', ['/api/control/automation/rules/{id}/pause'], requestSchema(
  'AutomationRulePauseRequest',
  'Pauses or resumes a rule version. Both boolean compatibility keys default to paused when absent.',
  { isPaused: boolean('Whether the rule is paused.'), pause: boolean('Compatibility alias for isPaused.') }
));

add('POST', ['/api/control/automation/scheduler/run'], requestSchema(
  'AutomationSchedulerRunRequest',
  'Runs a scheduler tick, optionally scoped to a tenant and simulation mode.',
  { clock: string('Evaluation clock.', 'date-time'), targetTenantId: string('Optional target tenant identifier.'), dryRun: boolean('Whether to avoid applying effects.') }
));

add('POST', ['/api/control/automation/simulate'], requestSchema(
  'AutomationSimulationRequest',
  'Simulates rule decisions against an optional tenant state projection.',
  {
    ruleId: string('Rule identifier.'),
    rule_id: string('Compatibility alias for ruleId.'),
    tenantId: string('Tenant identifier.'),
    tenant_id: string('Compatibility alias for tenantId.'),
    tenantStatus: string('Tenant lifecycle status; defaults to active.'),
    trialExpired: boolean('Whether the trial is expired.'),
    hasActivePaidSubscription: boolean('Whether an active paid subscription exists.'),
    hasPaidGrant: boolean('Whether a paid grant exists.'),
    state_override: object('Compatibility state override object.'),
    clock: string('Evaluation clock.', 'date-time')
  }
));

add('POST', ['/api/control/automation/tick'], requestSchema(
  'AutomationTickRequest',
  'Processes one durable outbox batch.',
  { batchSize: integer('Maximum batch size; defaults to 10.'), workerId: string('Worker identity for fencing.') }
));

add('POST', ['/api/control/backup', '/api/control/provisioning/backup'], requestSchema(
  'TenantBackupRequest',
  'Creates a tenant backup snapshot through the migration/restore harness.',
  { tenantId: string('Tenant identifier.'), backupKind: string('Backup kind.') }
));

add('POST', ['/api/control/billing/invoices/{id}/refund', '/api/control/billing/refund'], requestSchema(
  'BillingRefundRequest',
  'Refunds a transaction, or resolves the transaction from an invoice path parameter.',
  { transactionId: string('Transaction identifier.'), reason: string('Refund reason.') }
));

add('POST', ['/api/control/billing/plans', '/api/control/billing/plans/draft'], requestSchema(
  'BillingDraftPlanRequest',
  'Creates or updates a draft plan. code and planCode are compatibility aliases; additional plan fields are passed through to the pricing service.',
  {
    code: string('Compatibility plan code.'),
    planCode: string('Commercial plan code.'),
    nameFa: string('Plan display name.'),
    descriptionFa: string('Plan description.'),
    basePriceMonthlyRials: number('Monthly base price in Rials.'),
    includedBranches: integer('Included branch count.'),
    includedDevices: integer('Included device count.'),
    includedUsers: integer('Included user count.'),
    includedFeatures: array(string('Feature key.'), 'Included feature keys.'),
    quotas: object('Plan quota configuration.'),
    version: string('Draft plan version.')
  },
  ['planCode', 'nameFa']
));

add('POST', ['/api/control/billing/plans/{code}/publish'], requestSchema(
  'BillingPlanPublishRequest',
  'Publishes a plan at an optional effective date.',
  { effectiveFrom: string('Effective publication timestamp.', 'date-time') }
));

add('POST', ['/api/control/billing/subscriptions/{id}/renew'], requestSchema(
  'BillingSubscriptionRenewRequest',
  'Renews a subscription for a positive integer number of months; defaults to one month.',
  { months: integer('Number of renewal months.') }
));

add('POST', [
  '/api/control/crypto/reencrypt-batch',
  '/api/control/data/crypto/reencrypt-batch',
  '/api/control/data/keyring/reencrypt',
  '/api/control/data/support/crypto/reencrypt-batch',
  '/api/control/data/support/keyring/reencrypt',
  '/api/control/keyring/reencrypt',
  '/api/control/support/crypto/reencrypt-batch',
  '/api/control/support/keyring/reencrypt',
  '/api/control/support/support/crypto/reencrypt-batch',
  '/api/control/support/support/keyring/reencrypt'
], requestSchema(
  'KeyringReencryptBatchRequest',
  'Processes a bounded keyring re-encryption batch with cursor pagination. camelCase and snake_case names are compatibility aliases.',
  {
    targetVersion: string('Target keyring version.'),
    target_version: string('Compatibility alias for targetVersion.'),
    batchSize: integer('Maximum records in the batch.'),
    batch_size: integer('Compatibility alias for batchSize.'),
    cursor: integer('Opaque numeric batch cursor.')
  }
));

add('POST', [
  '/api/control/crypto/rotate-key',
  '/api/control/data/crypto/rotate-key',
  '/api/control/data/keyring/rotate',
  '/api/control/data/support/crypto/rotate-key',
  '/api/control/data/support/keyring/rotate',
  '/api/control/keyring/rotate',
  '/api/control/support/crypto/rotate-key',
  '/api/control/support/keyring/rotate',
  '/api/control/support/support/crypto/rotate-key',
  '/api/control/support/support/keyring/rotate'
], requestSchema(
  'KeyringRotateRequest',
  'Rotates the keyring or rewraps a supplied ciphertext. targetVersion is used for ciphertext rotation and newVersion/targetVersion for keyring rotation.',
  {
    newVersion: string('New keyring version.'),
    ciphertext: string('Ciphertext to rewrap.'),
    targetVersion: string('Target keyring version.'),
    target_version: string('Compatibility alias for targetVersion.')
  }
));

add('POST', [
  '/api/control/customers/{id}/reveal',
  '/api/control/data/customers/{id}/reveal',
  '/api/control/data/data/customers/{id}/reveal',
  '/api/control/support/customers/{id}/reveal',
  '/api/control/support/data/customers/{id}/reveal'
], requestSchema(
  'CustomerPhoneRevealRequest',
  'Reveals customer PII under a documented reason and optional support session. tenantId/tenant_id and sessionId/session_id are compatibility aliases.',
  {
    reason: string('Documented PII reveal reason.'),
    tenantId: string('Tenant identifier.'),
    tenant_id: string('Compatibility alias for tenantId.'),
    sessionId: string('Support session identifier.'),
    session_id: string('Compatibility alias for sessionId.')
  },
  ['reason']
));

add('POST', [
  '/api/control/customers/search',
  '/api/control/data/customers/search',
  '/api/control/data/data/customers/search',
  '/api/control/support/customers/search',
  '/api/control/support/data/customers/search'
], requestSchema(
  'CustomerSearchRequest',
  'Searches the tenant customer directory with masked output. tenantId/tenant_id and query/phone are compatibility alternatives.',
  {
    tenantId: string('Tenant identifier.'),
    tenant_id: string('Compatibility alias for tenantId.'),
    query: string('Search query.'),
    phone: string('Compatibility exact-phone query.'),
    searchType: string('Search mode.'),
    limit: integer('Maximum result count.')
  }
));

add('POST', ['/api/control/data/pii/encrypt', '/api/control/pii/encrypt'], requestSchema(
  'PiiEncryptRequest',
  'Encrypts a PII value and returns ciphertext plus a masked projection.',
  { plaintext: string('Plaintext PII value.'), fieldType: string('PII field type; defaults to phone.') },
  ['plaintext']
));

add('POST', ['/api/control/data/pii/reveal', '/api/control/pii/reveal'], requestSchema(
  'PiiRevealRequest',
  'Reveals encrypted PII under an audited reason; tenantId defaults to global only for the legacy wrapper.',
  { ciphertext: string('Encrypted PII ciphertext.'), reason: string('Documented reveal reason.'), tenantId: string('Tenant identifier.') },
  ['ciphertext', 'reason']
));

add('POST', [
  '/api/control/data/sessions',
  '/api/control/data/support/sessions',
  '/api/control/sessions',
  '/api/control/support/support/sessions'
], requestSchema(
  'SupportSessionCreateRequest',
  'Creates a time-bounded support session. ticketId/ticket_id, tenantId/tenant_id, viewAsUserId/view_as_user_id, sessionScope/session_scope, scopedActions/scoped_actions and write aliases are accepted for compatibility.',
  {
    ticketId: string('Backing support ticket identifier.'),
    ticket_id: string('Compatibility alias for ticketId.'),
    tenantId: string('Tenant identifier.'),
    tenant_id: string('Compatibility alias for tenantId.'),
    viewAsUserId: string('Target tenant user identifier.'),
    view_as_user_id: string('Compatibility alias for viewAsUserId.'),
    sessionScope: string('read_only or scoped_write.'),
    session_scope: string('Compatibility alias for sessionScope.'),
    reason: string('Documented support reason; minimum length enforced by service.'),
    durationMinutes: integer('Session duration in minutes.'),
    duration_minutes: integer('Compatibility alias for durationMinutes.'),
    isWriteAllowed: boolean('Whether scoped writes are allowed.'),
    scoped_write: boolean('Compatibility write flag.'),
    writeJustification: string('Required for scoped writes.'),
    scoped_write_reason: string('Compatibility alias for writeJustification.'),
    write_justification: string('Compatibility alias for writeJustification.'),
    scopedActions: array(string('Scoped action key.'), 'Allowed scoped actions.'),
    scoped_actions: array(string('Scoped action key.'), 'Compatibility alias for scopedActions.')
  },
  ['reason']
));

add('POST', [
  '/api/control/data/sessions/revoke-all',
  '/api/control/data/support/sessions/revoke-all',
  '/api/control/sessions/revoke-all',
  '/api/control/support/sessions/revoke-all',
  '/api/control/support/support/sessions/revoke-all'
], requestSchema(
  'SupportSessionsRevokeAllRequest',
  'Revokes all active support sessions globally or for a tenant.',
  { tenantId: string('Tenant identifier.'), tenant_id: string('Compatibility alias for tenantId.') }
));

add('POST', ['/api/control/data/sessions/tenant-approval', '/api/control/sessions/tenant-approval'], requestSchema(
  'SupportSessionTenantApprovalCompatibilityRequest',
  'Compatibility mounts for the one-time Tenant approval workflow. approvalToken/approval_token is consumed by the handler.',
  {
    approvalToken: string('One-time approval token.'),
    approval_token: string('Compatibility alias for approvalToken.'),
    tenantId: string('Tenant identifier.'),
    tenant_id: string('Compatibility alias for tenantId.'),
    decision: string('approve or reject.'),
    approverIdentityId: string('Tenant owner/manager identity.'),
    approver_identity_id: string('Compatibility alias for approverIdentityId.'),
    approverEmail: string('Approver email.', 'email'),
    approver_email: string('Compatibility alias for approverEmail.', 'email'),
    reason: string('Documented approval reason.')
  },
  ['decision', 'reason']
));

add('POST', [
  '/api/control/data/sessions/validate',
  '/api/control/data/support/sessions/validate',
  '/api/control/sessions/validate',
  '/api/control/support/support/sessions/validate'
], requestSchema(
  'SupportSessionValidateCompatibilityRequest',
  'Validates an opaque support session token through a compatibility mount.',
  { rawToken: string('Opaque support session token.') },
  ['rawToken']
));

add('POST', [
  '/api/control/data/support/tickets',
  '/api/control/data/tickets',
  '/api/control/support/support/tickets',
  '/api/control/tickets'
], requestSchema(
  'SupportTicketCompatibilityRequest',
  'Creates a support ticket through a compatibility mount. tenantId/tenant_id and title/subject are aliases.',
  {
    tenantId: string('Tenant identifier.'),
    tenant_id: string('Compatibility alias for tenantId.'),
    title: string('Ticket title.'),
    subject: string('Compatibility title alias.'),
    description: string('Ticket description.'),
    priority: string('Ticket priority.'),
    severity: string('Compatibility priority alias.'),
    category: string('Ticket category.'),
    creatorEmail: string('Requester email.', 'email'),
    creator_email: string('Compatibility alias for creatorEmail.', 'email'),
    attachments: array(object('Attachment metadata.'), 'Attachment metadata.')
  },
  ['description']
));

add('POST', [
  '/api/control/data/support/tickets/{id}/messages',
  '/api/control/data/tickets/{id}/messages',
  '/api/control/support/support/tickets/{id}/messages',
  '/api/control/tickets/{id}/messages'
], requestSchema(
  'SupportMessageCompatibilityRequest',
  'Adds a support ticket message. messageBody/body are compatibility aliases.',
  {
    messageBody: string('Message body.'),
    body: string('Compatibility alias for messageBody.'),
    isInternal: boolean('Whether the message is internal.'),
    is_internal: boolean('Compatibility alias for isInternal.'),
    attachments: array(object('Attachment metadata.'), 'Attachment metadata.')
  }
));

add('PATCH', [
  '/api/control/data/support/tickets/{id}/status',
  '/api/control/data/tickets/{id}/status',
  '/api/control/support/support/tickets/{id}/status',
  '/api/control/support/tickets/{id}/status',
  '/api/control/tickets/{id}/status'
], requestSchema(
  'SupportTicketStatusCompatibilityRequest',
  'Updates support ticket status, assignee and priority.',
  { status: string('Ticket lifecycle status.'), assignedTo: string('Assigned platform identity.'), priority: string('Ticket priority.') }
));

add('POST', ['/api/control/edge/devices/{id}/fence'], requestSchema(
  'EdgeDeviceFenceRequest',
  'Fences an Edge device for a tenant and optional reason.',
  { tenant_id: string('Tenant identifier.'), reason: string('Fence reason.') }
));

add('POST', ['/api/control/edge/packages'], requestSchema(
  'EdgePackageRegistrationRequest',
  'Registers a signed Edge package. secret_key is intentionally prohibited by the handler.',
  {
    version: string('Package version.'),
    package_url: string('Package artifact URL.', 'uri'),
    raw_content: string('Raw package content when URL delivery is not used.'),
    signature_hex: string('Ed25519 signature in hexadecimal form.'),
    secret_key: string('Prohibited compatibility field; the server rejects it.')
  }
));

add('DELETE', ['/api/control/identities/{id}'], requestSchema(
  'IdentityDeleteRequest',
  'Deletes a tenant membership; tenantId may be supplied in the body or query.',
  { tenantId: string('Tenant identifier.') },
  ['tenantId']
));

add('POST', ['/api/control/identities/{id}/reactivate'], requestSchema(
  'IdentityReactivateRequest',
  'Reactivates a tenant membership.',
  { tenantId: string('Tenant identifier.') },
  ['tenantId']
));

add('POST', ['/api/control/identities/{id}/revoke'], requestSchema(
  'IdentityRevokeRequest',
  'Revokes a tenant membership with an optional reason.',
  { tenantId: string('Tenant identifier.'), reason: string('Revocation reason.') },
  ['tenantId']
));

add('PATCH', ['/api/control/identities/{id}/role'], requestSchema(
  'IdentityRoleUpdateRequest',
  'Updates a membership role and optional branch scope.',
  { tenantId: string('Tenant identifier.'), role: string('Tenant role.'), branchScope: string('Branch scope.') },
  ['tenantId', 'role']
));

add('POST', ['/api/control/identities/{id}/suspend'], requestSchema(
  'IdentitySuspendRequest',
  'Suspends a tenant membership with an optional reason.',
  { tenantId: string('Tenant identifier.'), reason: string('Suspension reason.') },
  ['tenantId']
));

add('POST', [
  '/api/control/jobs/{jobId}/quarantine',
  '/api/control/provision/{jobId}/quarantine',
  '/api/control/provisioning/jobs/{jobId}/quarantine',
  '/api/control/provisioning/provision/{jobId}/quarantine'
], requestSchema(
  'ProvisioningQuarantineRequest',
  'Quarantines a provisioning job with an optional operator reason.',
  { reason: string('Quarantine reason.') }
));

add('POST', ['/api/control/provisioning/invitations/accept'], requestSchema(
  'InvitationAcceptCompatibilityRequest',
  'Accepts an invitation through the compatibility provisioning mount.',
  { rawToken: string('Opaque invitation token.'), newPassword: string('New owner password.') },
  ['rawToken', 'newPassword']
));

add('POST', ['/api/control/provisioning/jobs', '/api/control/provisioning/provision'], requestSchema(
  'ProvisionTenantCompatibilityRequest',
  'Starts an idempotent tenant provisioning job through a compatibility mount.',
  {
    tenantId: string('Stable tenant identifier.'),
    displayName: string('Tenant display name.'),
    cellId: string('Target cell identifier.'),
    planCode: string('Commercial plan code.'),
    canonicalDomain: string('Canonical tenant domain.', 'hostname'),
    ownerEmail: string('Initial owner email.', 'email'),
    templateCode: string('Zero-data template code.'),
    idempotencyKey: string('Idempotency key.')
  },
  ['tenantId', 'displayName', 'ownerEmail']
));

add('POST', ['/api/control/provisioning/restore-test', '/api/control/restore-test'], requestSchema(
  'RestoreTestRequest',
  'Runs an isolated restore test against a named sandbox.',
  { backupId: string('Backup identifier.'), targetSandbox: string('Isolated restore sandbox identifier.') }
));

function getPayloadContract(method, openApiPath) {
  return contracts[`${method.toUpperCase()} ${openApiPath}`] || null;
}

function getNoBodyContract(method, openApiPath) {
  return noBodyContracts[`${method.toUpperCase()} ${openApiPath}`] || null;
}

function listPayloadContracts() {
  return { ...contracts };
}

module.exports = { getPayloadContract, getNoBodyContract, listPayloadContracts };
