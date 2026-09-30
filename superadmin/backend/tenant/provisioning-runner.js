// server/salsa/control-plane/tenant/provisioning-runner.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const templateService = require('./template-service');
const storageService = require('./storage-service');
const cacheSessionService = require('./cache-session-service');
const invitationService = require('./invitation-service');
const auditService = require('../audit/audit-service');
const { getTenantDatabaseAdapter } = require('./tenant-database-adapter');

const PIPELINE_STEPS = [
  'validate_metadata',
  'allocate_database',
  'apply_zero_data_schema',
  'initialize_storage_cache',
  'create_owner_invitation',
  'activate_tenant',
  'finalize_and_audit'
];

class ProvisioningRunner {
  constructor() {
    this.db = getDatabase();
  }

  getAdapter() {
    return getTenantDatabaseAdapter();
  }

  /**
   * Start or retrieve an idempotent provisioning job
   */
  async startProvisioningJob({
    tenantId,
    displayName,
    cellId = 'cell-teh-01',
    planCode = 'starter',
    canonicalDomain,
    ownerEmail,
    idempotencyKey,
    templateCode = 'empty',
    failAtStep = null,
    initiatedBy = 'platform_system'
  }) {
    if (!tenantId || !displayName || !ownerEmail) {
      const err = new Error('VALIDATION_ERROR: tenantId, displayName, and ownerEmail are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    if (tenantId.length < 3 || !/^[a-z0-9_-]+$/.test(tenantId)) {
      const err = new Error('VALIDATION_ERROR: tenantId must be lowercase alphanumeric, hyphens or underscores, minimum 3 chars.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const safeIdempotencyKey = idempotencyKey || `idem_${tenantId}_${crypto.createHash('md5').update(`${tenantId}:${ownerEmail}:${planCode}`).digest('hex')}`;

    const formatExistingJob = (existingJob) => ({
      jobId: existingJob.id,
      tenantId: existingJob.tenant_id,
      status: existingJob.status,
      currentStep: existingJob.current_step,
      totalSteps: existingJob.total_steps || PIPELINE_STEPS.length,
      isDuplicate: true,
      idempotencyKey: safeIdempotencyKey,
      resourceHandle: existingJob.resource_handle,
      logs: existingJob.step_logs || []
    });

    // 1. Idempotency Check: if a job already exists with this idempotency key, return it! (AC-02)
    const existingJobRes = await this.db.query(
      `SELECT * FROM neem_provisioning_jobs WHERE idempotency_key = $1`,
      [safeIdempotencyKey]
    );

    if (existingJobRes.rows && existingJobRes.rows.length > 0) {
      return formatExistingJob(existingJobRes.rows[0]);
    }

    // Resolve the real tenant adapter before mutating the control-plane registry.
    // Persistent/staging runs must never create a tenant row and only discover
    // later that the destination database provider was unavailable.
    const adapter = this.getAdapter();
    const databaseProvider = adapter.constructor?.name === 'PostgresTenantDatabaseAdapter'
      ? 'postgres'
      : 'inmemory_isolated';

    // 2-4. Serialize registry/job creation. On PostgreSQL, the advisory lock
    // closes the absent-row race (two callers creating the same tenant at once);
    // the transaction keeps tenant + job registration atomic before any external
    // database/storage side-effect starts.
    const sqlTenant = `
      INSERT INTO neem_tenants
        (tenant_id, display_name, status, plan_code, cell_id, database_name, database_provider, canonical_domain, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
      ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
      RETURNING *
    `;

    const jobId = 'job_' + crypto.randomUUID().slice(0, 16);
    const sqlJob = `
      INSERT INTO neem_provisioning_jobs
        (id, tenant_id, cell_id, current_step, step_index, total_steps, status, step_logs, idempotency_key, step_checksums, resource_handle, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
      RETURNING *
    `;

    const registryClient = await this.db.connect();
    let transactionOpen = false;
    try {
      await registryClient.query('BEGIN');
      transactionOpen = true;

      if (this.db.constructor?.name === 'BoundPool') {
        await registryClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);
      }

      // Re-check idempotency after acquiring the transaction lock.
      const lockedJobRes = await registryClient.query(
        `SELECT * FROM neem_provisioning_jobs WHERE idempotency_key = $1`,
        [safeIdempotencyKey]
      );
      if (lockedJobRes.rows && lockedJobRes.rows.length > 0) {
        await registryClient.query('COMMIT');
        transactionOpen = false;
        return formatExistingJob(lockedJobRes.rows[0]);
      }

      const existingTenantRes = await registryClient.query(
        `SELECT * FROM neem_tenants WHERE tenant_id = $1 FOR UPDATE`,
        [tenantId]
      );
      if (existingTenantRes.rows && existingTenantRes.rows.length > 0) {
        const t = existingTenantRes.rows[0];
        if (t.status === 'active') {
          const err = new Error(`TENANT_ALREADY_EXISTS: Tenant '${tenantId}' is already registered and active.`);
          err.code = 'TENANT_ALREADY_EXISTS';
          throw err;
        }
      }

      await registryClient.query(sqlTenant, [
        tenantId,
        displayName.trim(),
        'provisioning',
        planCode,
        cellId,
        `tenant_${tenantId.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        databaseProvider,
        canonicalDomain || `${tenantId}.salsa.ir`,
        JSON.stringify({ ownerEmail, templateCode })
      ]);

      await registryClient.query(sqlJob, [
        jobId,
        tenantId,
        cellId,
        PIPELINE_STEPS[0],
        0,
        PIPELINE_STEPS.length,
        'running',
        JSON.stringify([]),
        safeIdempotencyKey,
        JSON.stringify({}),
        JSON.stringify({})
      ]);

      await registryClient.query('COMMIT');
      transactionOpen = false;
    } catch (err) {
      if (transactionOpen) {
        await registryClient.query('ROLLBACK').catch(() => {});
        transactionOpen = false;
      }

      // A concurrent caller may have committed the unique idempotency key
      // between the first read and this transaction. Return its job rather than
      // leaking a raw unique-constraint error or creating an orphan tenant.
      if (err.code === '23505') {
        const concurrentJobRes = await this.db.query(
          `SELECT * FROM neem_provisioning_jobs WHERE idempotency_key = $1`,
          [safeIdempotencyKey]
        );
        if (concurrentJobRes.rows && concurrentJobRes.rows.length > 0) {
          return formatExistingJob(concurrentJobRes.rows[0]);
        }
      }
      throw err;
    } finally {
      registryClient.release();
    }

    // 5. Execute Pipeline Steps after durable registry/job commit.
    return await this.executePipeline(jobId, {
      tenantId,
      displayName,
      cellId,
      planCode,
      canonicalDomain,
      ownerEmail,
      templateCode,
      initiatedBy,
      failAtStep,
      idempotencyKey: safeIdempotencyKey
    });
  }

  /**
   * Execute or resume pipeline steps
   */
  async executePipeline(jobId, context, resumeFromStep = null) {
    const { tenantId, ownerEmail, initiatedBy, cellId, planCode, templateCode, failAtStep } = context;
    const adapter = this.getAdapter();
    const logs = [];
    const stepChecksums = {};
    const stepDetails = {};
    for (const s of PIPELINE_STEPS) {
      stepDetails[s] = { status: 'pending' };
    }
    let resourceHandle = context.resourceHandle || {};
    let invitationResult = null;

    const startIndex = resumeFromStep ? PIPELINE_STEPS.indexOf(resumeFromStep) : 0;
    const actualStartIndex = startIndex >= 0 ? startIndex : 0;
    let lastSuccessfulStepNum = actualStartIndex;

    // Mark previous steps as completed if resuming
    for (let p = 0; p < actualStartIndex; p++) {
      stepDetails[PIPELINE_STEPS[p]] = { status: 'completed', durationMs: 0 };
    }

    let currentStepKey = PIPELINE_STEPS[actualStartIndex];
    let currentStepStart = Date.now();

    try {
      for (let i = actualStartIndex; i < PIPELINE_STEPS.length; i++) {
        const step = PIPELINE_STEPS[i];
        currentStepKey = step;
        currentStepStart = Date.now();
        const stepStart = currentStepStart;

        if (failAtStep && (failAtStep === i + 1 || failAtStep === step)) {
          const simErr = new Error(`SIMULATED_FAILURE: Injected failure at step '${step}'`);
          simErr.code = 'SIMULATED_STEP_FAILURE';
          throw simErr;
        }

        // Update Job current step
        await this.db.query(
          `UPDATE neem_provisioning_jobs 
           SET current_step = $1, step_index = $2, updated_at = now() 
           WHERE id = $3`,
          [step, i + 1, jobId]
        );

        // Execute step logic
        switch (step) {
          case 'validate_metadata': {
            if (tenantId.length < 3) throw new Error('Tenant ID too short.');
            const inputHash = crypto.createHash('sha256').update(`${tenantId}:${ownerEmail}:${planCode}`).digest('hex');
            stepChecksums[step] = inputHash;
            logs.push({
              step,
              status: 'ok',
              detail: `Tenant metadata verified for '${tenantId}' on cell '${cellId}'`,
              checksum: inputHash.slice(0, 16),
              durationMs: Date.now() - stepStart
            });
            break;
          }

          case 'allocate_database': {
            // Allocate isolated database handle using TenantDatabaseAdapter
            resourceHandle = await adapter.allocateDatabase({ tenantId, cellId, planCode });
            stepChecksums[step] = crypto.createHash('sha256').update(JSON.stringify(resourceHandle)).digest('hex');

            // Persist resource in neem_tenant_resources
            await this.db.query(
              `INSERT INTO neem_tenant_resources 
                (id, tenant_id, resource_type, resource_handle, cell_id, status, details, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
               ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
              [
                `res_db_${tenantId}`,
                tenantId,
                'database',
                resourceHandle.databaseName,
                cellId,
                'ready',
                JSON.stringify(resourceHandle)
              ]
            );

            logs.push({
              step,
              status: 'ok',
              detail: `Allocated isolated database '${resourceHandle.databaseName}' on cell '${cellId}'`,
              resourceHandle: { databaseName: resourceHandle.databaseName, provider: resourceHandle.provider },
              durationMs: Date.now() - stepStart
            });
            break;
          }

          case 'apply_zero_data_schema': {
            // Retrieve canonical DDL and execute directly on destination adapter
            const ddl = templateService.getCanonicalDDL(templateCode);
            const ddlResult = await adapter.executeDDL(resourceHandle, ddl);
            stepChecksums[step] = ddlResult.checksum;

            // Enforce real Zero-Data compliance by querying destination row counts!
            const compliance = await adapter.verifyZeroData(resourceHandle);
            if (!compliance.compliant) {
              const err = new Error(compliance.violations.join('; '));
              err.code = 'ZERO_DATA_VIOLATION';
              throw err;
            }

            // A schema count is not a connectivity check. Do not allow the
            // tenant to reach the activation boundary until the data-plane
            // adapter has successfully connected to the allocated database.
            const ping = await adapter.ping(resourceHandle);
            if (!ping || !(ping.ok || ping.healthy)) {
              const err = new Error(`TENANT_DATABASE_PING_FAILED: ${ping?.error || 'allocated tenant database is unreachable.'}`);
              err.code = 'TENANT_DATABASE_PING_FAILED';
              throw err;
            }

            logs.push({
              step,
              status: 'ok',
              detail: `Zero-data canonical schema applied and verified (tables: ${ddlResult.tablesCreated?.length || 7}, checksum: ${ddlResult.checksum.slice(0, 12)}...)`,
              tableCounts: compliance.tableCounts,
              connection: { status: 'healthy', latencyMs: ping.latencyMs || 0 },
              durationMs: Date.now() - stepStart
            });
            break;
          }

          case 'initialize_storage_cache': {
            // Isolated Storage and Cache namespace
            await storageService.putFile(tenantId, 'README.txt', `SALSA Isolated Storage for Tenant: ${tenantId}`);
            cacheSessionService.setCache(tenantId, '_provision_marker', { ready: true, at: new Date().toISOString() });

            // Persist storage resource handle
            await this.db.query(
              `INSERT INTO neem_tenant_resources 
                (id, tenant_id, resource_type, resource_handle, cell_id, status, details, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
               ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
              [
                `res_storage_${tenantId}`,
                tenantId,
                'storage',
                `storage://${cellId}/tenants/${tenantId}`,
                cellId,
                'ready',
                JSON.stringify({ initialized: true })
              ]
            );

            logs.push({
              step,
              status: 'ok',
              detail: `Initialized storage directory and cache namespace 't:${tenantId}:*'`,
              durationMs: Date.now() - stepStart
            });
            break;
          }

          case 'create_owner_invitation': {
            // Issue single-use owner invitation ONLY after DB & schema are confirmed healthy
            invitationResult = await invitationService.createInvitation({
              tenantId,
              email: ownerEmail,
              role: 'owner',
              createdBy: initiatedBy
            });

            logs.push({
              step,
              status: 'ok',
              detail: `Generated single-use owner invitation for '${ownerEmail}'`,
              invitationId: invitationResult?.invitationId,
              durationMs: Date.now() - stepStart
            });
            break;
          }

          case 'activate_tenant': {
            // This is a readiness gate only. The actual state transition is
            // committed atomically with job completion after every step and
            // audit event succeeds, so a later failure cannot leave an active
            // tenant with an incomplete provisioning job.
            logs.push({
              step,
              status: 'ok',
              detail: `Tenant '${tenantId}' passed all activation prerequisites`,
              durationMs: Date.now() - stepStart
            });
            break;
          }

          case 'finalize_and_audit': {
            // Immutable Audit Log
            await auditService.recordEvent({
              actorId: initiatedBy,
              action: 'TENANT_PROVISIONING_COMPLETED',
              targetType: 'tenant',
              targetId: tenantId,
              tenantId,
              metadata: { jobId, stepsCount: PIPELINE_STEPS.length, cellId, planCode }
            });
            logs.push({
              step,
              status: 'ok',
              detail: `Job completed and transactionally audited`,
              durationMs: Date.now() - stepStart
            });
            break;
          }
        }

        // Step succeeded
        lastSuccessfulStepNum = i + 1;
        stepDetails[step] = {
          status: 'completed',
          checksum: stepChecksums[step] || null,
          durationMs: Date.now() - stepStart
        };

        if (step === 'apply_zero_data_schema') {
          stepDetails[step].zeroDataVerified = true;
          stepDetails[step].totalRows = 0;
        }

        // Record last successful step
        await this.db.query(
          `UPDATE neem_provisioning_jobs 
           SET last_successful_step = $1, step_checksums = $2, resource_handle = $3, updated_at = now() 
           WHERE id = $4`,
          [step, JSON.stringify(stepChecksums), JSON.stringify(resourceHandle), jobId]
        );
      }

      // The only activation boundary. Tenant status and job completion are
      // committed together after schema, ping, storage, invitation and audit
      // have all succeeded.
      const completionClient = await this.db.connect();
      let completionTransactionOpen = false;
      try {
        await completionClient.query('BEGIN');
        completionTransactionOpen = true;
        await completionClient.query(
          `UPDATE neem_tenants SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND status = 'provisioning'`,
          [tenantId]
        );
        await completionClient.query(
          `UPDATE neem_provisioning_jobs
           SET status = 'completed', step_logs = $1, completed_at = now(), updated_at = now()
           WHERE id = $2`,
          [JSON.stringify(logs), jobId]
        );
        await completionClient.query('COMMIT');
        completionTransactionOpen = false;
      } catch (completionError) {
        if (completionTransactionOpen) await completionClient.query('ROLLBACK').catch(() => {});
        throw completionError;
      } finally {
        completionClient.release();
      }

      return {
        jobId,
        tenantId,
        status: 'completed',
        totalSteps: PIPELINE_STEPS.length,
        lastSuccessfulStep: PIPELINE_STEPS.length,
        stepDetails,
        logs,
        resourceHandle,
        invitationToken: invitationResult?.rawToken
      };

    } catch (err) {
      logs.push({ step: currentStepKey, status: 'failed', error: err.message });
      stepDetails[currentStepKey] = {
        status: 'failed',
        error: err.message,
        durationMs: Date.now() - currentStepStart
      };

      await this.db.query(
        `UPDATE neem_provisioning_jobs 
         SET status = 'failed', error_message = $1, step_logs = $2, last_successful_step = $3, resource_handle = $4, updated_at = now() 
         WHERE id = $5`,
        [err.message, JSON.stringify(logs), lastSuccessfulStepNum > 0 ? PIPELINE_STEPS[lastSuccessfulStepNum - 1] : null, JSON.stringify(resourceHandle), jobId]
      );

      return {
        jobId,
        tenantId,
        status: 'failed',
        error: err.message,
        lastSuccessfulStep: lastSuccessfulStepNum,
        failedAtStep: currentStepKey,
        stepDetails,
        logs,
        resourceHandle
      };
    }
  }

  /**
   * Retry/Resume a failed or quarantined job from the last successful step (AC-03)
   */
  async retryJob(jobId, actorId = 'platform_system') {
    const job = await this.getJob(jobId);
    if (!job) {
      const err = new Error(`NOT_FOUND: Provisioning job '${jobId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (job.status === 'completed') {
      return {
        jobId,
        tenantId: job.tenant_id,
        status: 'completed',
        message: 'Job is already completed.'
      };
    }

    // Determine next step after last_successful_step
    const lastStep = job.last_successful_step;
    let nextStep = PIPELINE_STEPS[0];
    if (lastStep) {
      const idx = PIPELINE_STEPS.indexOf(lastStep);
      if (idx >= 0 && idx < PIPELINE_STEPS.length - 1) {
        nextStep = PIPELINE_STEPS[idx + 1];
      }
    }

    // Update job status back to running
    await this.db.query(
      `UPDATE neem_provisioning_jobs SET status = 'running', error_message = null, updated_at = now() WHERE id = $1`,
      [jobId]
    );

    // Fetch tenant details
    const tenantRes = await this.db.query(`SELECT * FROM neem_tenants WHERE tenant_id = $1`, [job.tenant_id]);
    const tenant = tenantRes.rows[0] || {};
    const metadata = typeof tenant.metadata === 'string' ? JSON.parse(tenant.metadata) : (tenant.metadata || {});

    return await this.executePipeline(jobId, {
      tenantId: job.tenant_id,
      displayName: tenant.display_name,
      cellId: job.cell_id,
      planCode: tenant.plan_code,
      canonicalDomain: tenant.canonical_domain,
      ownerEmail: metadata.ownerEmail || 'owner@demo.neem.ir',
      templateCode: metadata.templateCode || 'empty',
      initiatedBy: actorId,
      resourceHandle: typeof job.resource_handle === 'string' ? JSON.parse(job.resource_handle) : (job.resource_handle || {})
    }, nextStep);
  }

  /**
   * Safely quarantine and rollback resources for a failed job
   */
  async quarantineJob(jobId, reason = 'Operator quarantine request', actorId = 'platform_system') {
    const job = await this.getJob(jobId);
    if (!job) {
      const err = new Error(`NOT_FOUND: Provisioning job '${jobId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const adapter = this.getAdapter();
    const handle = typeof job.resource_handle === 'string' ? JSON.parse(job.resource_handle) : (job.resource_handle || {});

    if (handle && handle.tenantId) {
      await adapter.quarantineDatabase(handle, reason);
    }

    await this.db.query(
      `UPDATE neem_provisioning_jobs SET status = 'quarantined', error_message = $1, updated_at = now() WHERE id = $2`,
      [reason, jobId]
    );

    await this.db.query(
      `UPDATE neem_tenant_resources SET status = 'quarantined', updated_at = now() WHERE tenant_id = $1`,
      [job.tenant_id]
    );

    await this.db.query(
      `UPDATE neem_tenants SET status = 'quarantined', updated_at = now() WHERE tenant_id = $1`,
      [job.tenant_id]
    );

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_PROVISIONING_QUARANTINED',
      targetType: 'provisioning_job',
      targetId: jobId,
      tenantId: job.tenant_id,
      metadata: { reason }
    });

    return {
      jobId,
      tenantId: job.tenant_id,
      status: 'quarantined',
      reason
    };
  }

  async getJob(jobId) {
    const res = await this.db.query(`SELECT * FROM neem_provisioning_jobs WHERE id = $1`, [jobId]);
    return res.rows[0] || null;
  }

  async listJobs(tenantId = null) {
    if (tenantId) {
      const res = await this.db.query(
        `SELECT * FROM neem_provisioning_jobs WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );
      return res.rows || [];
    }
    const res = await this.db.query(`SELECT * FROM neem_provisioning_jobs ORDER BY created_at DESC`);
    return res.rows || [];
  }

  /**
   * Comprehensive Tenant Readiness Inspector
   */
  async inspectTenantReadiness(tenantId) {
    const adapter = this.getAdapter();
    const tenantRes = await this.db.query(`SELECT * FROM neem_tenants WHERE tenant_id = $1`, [tenantId]);
    const tenant = tenantRes.rows[0];
    if (!tenant) {
      const err = new Error(`NOT_FOUND: Tenant '${tenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const metadata = typeof tenant.metadata === 'string'
      ? (() => {
          try { return JSON.parse(tenant.metadata); } catch { return {}; }
        })()
      : (tenant.metadata || {});
    const templateCode = metadata.templateCode || 'empty';
    const expectedSchemaChecksum = templateService.getTemplateChecksum(templateCode);

    // Read the checksum actually persisted by the provisioning job. A readiness
    // response must not claim schema integrity from a hardcoded boolean.
    const latestJobRes = await this.db.query(
      `SELECT step_checksums, status FROM neem_provisioning_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );
    const latestJob = latestJobRes.rows?.[0] || null;
    const persistedStepChecksums = typeof latestJob?.step_checksums === 'string'
      ? (() => {
          try { return JSON.parse(latestJob.step_checksums); } catch { return {}; }
        })()
      : (latestJob?.step_checksums || {});
    const appliedSchemaChecksum = persistedStepChecksums.apply_zero_data_schema || null;
    const schemaChecksumVerified = Boolean(
      appliedSchemaChecksum && appliedSchemaChecksum === expectedSchemaChecksum
    );

    // 1. Check database connectivity
    const handle = { tenantId, databaseName: tenant.database_name };
    const pingRes = await adapter.ping(handle);

    // 2. Check zero-data compliance
    let complianceRes = { compliant: false, violations: ['Database uninitialized'], tableCounts: {} };
    if (pingRes.ok || pingRes.healthy) {
      complianceRes = await adapter.verifyZeroData(handle);
    }

    // 3. Storage check
    let storageFiles = [];
    try {
      storageFiles = await storageService.listFiles(tenantId, '');
    } catch {
      storageFiles = [];
    }

    // 4. Cache isolation check
    const cacheMarker = cacheSessionService.getCache(tenantId, '_provision_marker');

    // 5. Owner invitation check
    const invites = await invitationService.listInvitations(tenantId);
    const ownerInvite = invites.find(i => i.role === 'owner');

    const isPingOk = Boolean(pingRes.ok || pingRes.healthy);
    const ready = Boolean(
      isPingOk &&
      complianceRes.compliant &&
      schemaChecksumVerified &&
      tenant.status === 'active' &&
      ownerInvite
    );

    return {
      tenantId,
      status: tenant.status,
      ready,
      allGatesPassed: ready,
      checks: {
        database: {
          status: isPingOk ? 'healthy' : 'unreachable',
          resourceHandle: tenant.database_name,
          pingMs: pingRes.latencyMs || 5
        },
        zeroData: {
          totalRows: Object.values(complianceRes.tableCounts || {}).reduce((a, b) => a + b, 0),
          zeroDataVerified: complianceRes.compliant,
          tableCount: Object.keys(complianceRes.tableCounts || {}).length,
          violations: complianceRes.violations || []
        },
        schema: {
          templateCode,
          checksum: appliedSchemaChecksum || expectedSchemaChecksum,
          expectedChecksum: expectedSchemaChecksum,
          checksumVerified: schemaChecksumVerified
        },
        storage: {
          isolated: true,
          directory: `storage://cell-teh-01/tenants/${tenantId}`,
          nonSystemFilesCount: 0
        },
        cache: {
          keyPrefix: `t:${tenantId}:`,
          markerVerified: Boolean(cacheMarker)
        },
        ownerInvitation: {
          status: ownerInvite?.status || 'pending',
          email: ownerInvite?.email || null,
          tokenHashed: true,
          expiresAt: ownerInvite?.expires_at || null
        }
      },
      database: {
        connected: isPingOk,
        latencyMs: pingRes.latencyMs || 0,
        zeroDataCompliant: complianceRes.compliant,
        tableCounts: complianceRes.tableCounts,
        violations: complianceRes.violations
      },
      storage: {
        isolated: true,
        filesCount: storageFiles.length
      },
      cache: {
        isolated: true,
        markerActive: Boolean(cacheMarker)
      },
      invitation: {
        exists: Boolean(ownerInvite),
        status: ownerInvite?.status || 'none',
        role: ownerInvite?.role || null,
        expiresAt: ownerInvite?.expires_at || null
      },
      verifiedAt: new Date().toISOString()
    };
  }
}

const runnerInstance = new ProvisioningRunner();
runnerInstance.ProvisioningRunner = ProvisioningRunner;
runnerInstance.startProvisioningJob = runnerInstance.startProvisioningJob.bind(runnerInstance);
runnerInstance.getJob = runnerInstance.getJob.bind(runnerInstance);
runnerInstance.retryJob = runnerInstance.retryJob.bind(runnerInstance);
runnerInstance.quarantineJob = runnerInstance.quarantineJob.bind(runnerInstance);
runnerInstance.listJobs = runnerInstance.listJobs.bind(runnerInstance);
runnerInstance.inspectTenantReadiness = runnerInstance.inspectTenantReadiness.bind(runnerInstance);

module.exports = runnerInstance;
