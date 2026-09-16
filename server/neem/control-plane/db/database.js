// server/neem/control-plane/db/database.js
'use strict';

const config = require('../config');
const { sha256 } = require('../auth/crypto-util');

function safeJson(v, fallback = {}) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function getSeedTenantCustomers() {
  try {
    const cryptoPii = require('../support/crypto-pii');
    return [
      {
        id: 'cst-westo-001',
        tenant_id: 'westo-demo',
        full_name: 'مشتری تست ۱',
        phone_encrypted: cryptoPii.encrypt('09120000001', 'v1'),
        phone_hash: cryptoPii.computePhoneHash('09120000001'),
        phone_last4: '0001',
        national_id_encrypted: cryptoPii.encrypt('0000000001', 'v1'),
        loyalty_tier: 'gold',
        orders_count: 34,
        total_spend: 4850000,
        last_interaction_at: new Date('2026-03-01T14:30:00Z'),
        created_at: new Date('2025-01-10T10:00:00Z')
      },
      {
        id: 'cst-westo-002',
        tenant_id: 'westo-demo',
        full_name: 'مشتری تست ۲',
        phone_encrypted: cryptoPii.encrypt('09120000002', 'v1'),
        phone_hash: cryptoPii.computePhoneHash('09120000002'),
        phone_last4: '0002',
        national_id_encrypted: cryptoPii.encrypt('0000000002', 'v1'),
        loyalty_tier: 'silver',
        orders_count: 18,
        total_spend: 2240000,
        last_interaction_at: new Date('2026-03-02T16:45:00Z'),
        created_at: new Date('2025-02-15T12:00:00Z')
      },
      {
        id: 'cst-westo-003',
        tenant_id: 'westo-demo',
        full_name: 'مشتری تست ۳',
        phone_encrypted: cryptoPii.encrypt('09120000003', 'v1'),
        phone_hash: cryptoPii.computePhoneHash('09120000003'),
        phone_last4: '0003',
        national_id_encrypted: cryptoPii.encrypt('0000000003', 'v1'),
        loyalty_tier: 'standard',
        orders_count: 6,
        total_spend: 820000,
        last_interaction_at: new Date('2026-03-03T18:20:00Z'),
        created_at: new Date('2025-05-20T08:00:00Z')
      },
      {
        id: 'cst-shiraz-001',
        tenant_id: 'shiraz-bistrot',
        full_name: 'مشتری تست ۴',
        phone_encrypted: cryptoPii.encrypt('09120000004', 'v1'),
        phone_hash: cryptoPii.computePhoneHash('09120000004'),
        phone_last4: '0004',
        national_id_encrypted: cryptoPii.encrypt('0000000004', 'v1'),
        loyalty_tier: 'gold',
        orders_count: 22,
        total_spend: 3100000,
        last_interaction_at: new Date('2026-03-04T12:00:00Z'),
        created_at: new Date('2025-03-11T09:00:00Z')
      }
    ];
  } catch (e) {
    return [];
  }
}

class InMemoryClient {
  constructor(adapter) {
    this.adapter = adapter;
    this.inTransaction = false;
    this.snapshot = null;
    this.heldLocks = new Set();
  }

  async query(text, params) {
    const trimmed = (text || '').trim();
    const upper = trimmed.toUpperCase();

    if (upper === 'BEGIN') {
      this.inTransaction = true;
      this.snapshot = JSON.parse(JSON.stringify(this.adapter.tables));
      return { rows: [], rowCount: 0 };
    }

    if (upper === 'COMMIT') {
      this.inTransaction = false;
      this.snapshot = null;
      this.releaseLocks();
      return { rows: [], rowCount: 0 };
    }

    if (upper === 'ROLLBACK') {
      if (this.inTransaction && this.snapshot) {
        this.adapter.tables = this.snapshot;
        this.snapshot = null;
      }
      this.inTransaction = false;
      this.releaseLocks();
      return { rows: [], rowCount: 0 };
    }

    // Row-level lock simulation for FOR UPDATE / FOR NO KEY UPDATE
    if (upper.includes('FOR UPDATE') || upper.includes('FOR NO KEY UPDATE')) {
      this.adapter.rowLocks = this.adapter.rowLocks || new Map();
      let table = null;
      let id = null;
      if (upper.includes('FROM NEEM_TENANTS')) {
        table = 'neem_tenants';
        id = params && params[0];
      } else if (upper.includes('FROM NEEM_BILLING_INVOICES')) {
        table = 'neem_billing_invoices';
        id = params && params[0];
      } else if (upper.includes('FROM NEEM_BILLING_SUBSCRIPTIONS')) {
        table = 'neem_billing_subscriptions';
        id = params && params[0];
      }

      if (table && id) {
        const lockKey = `${table}:${id}`;
        const existingLock = this.adapter.rowLocks.get(lockKey);
        if (existingLock && existingLock !== this) {
          throw new Error(`CONCURRENT_LOCK_CONFLICT: Row '${lockKey}' is currently locked by another transaction.`);
        }
        this.adapter.rowLocks.set(lockKey, this);
        this.heldLocks.add(lockKey);
      }
    }

    return this.adapter.query(text, params);
  }

  releaseLocks() {
    if (this.adapter.rowLocks) {
      for (const lockKey of this.heldLocks) {
        if (this.adapter.rowLocks.get(lockKey) === this) {
          this.adapter.rowLocks.delete(lockKey);
        }
      }
    }
    this.heldLocks.clear();
  }

  release() {
    this.releaseLocks();
    if (this.inTransaction && this.snapshot) {
      this.adapter.tables = this.snapshot;
      this.snapshot = null;
      this.inTransaction = false;
    }
  }
}

class InMemoryTestAdapter {
  constructor() {
    this.tables = {
      neem_platform_principals: [],
      neem_platform_mfa_factors: [],
      neem_platform_recovery_codes: [],
      neem_platform_sessions: [],
      neem_tenants: [
        {
          tenant_id: 'westo-demo',
          display_name: 'کافه رستوران وستو (مستأجر نمونه)',
          status: 'active',
          plan_code: 'scale',
          version: 1,
          cell_id: 'cell-teh-01',
          database_name: 'tenant_westo_demo',
          database_provider: 'postgres',
          canonical_domain: 'westo.demo.neem.ir',
          metadata: { organization: 'مجموعه رستوران‌های آریا', branchesCount: 3 },
          created_at: new Date('2024-06-01T00:00:00Z'),
          updated_at: new Date('2024-06-01T00:00:00Z')
        },
        {
          tenant_id: 'shiraz-bistrot',
          display_name: 'بیسترو شیراز',
          status: 'active',
          plan_code: 'growth',
          version: 1,
          cell_id: 'cell-teh-01',
          database_name: 'tenant_shiraz_bistrot',
          database_provider: 'postgres',
          canonical_domain: 'bistrot.demo.neem.ir',
          metadata: { organization: 'کسب‌وکار نمونه جنوب', branchesCount: 1 },
          created_at: new Date('2024-07-01T00:00:00Z'),
          updated_at: new Date('2024-07-01T00:00:00Z')
        }
      ],
      neem_domains: [
        {
          domain: 'westo.demo.neem.ir',
          tenant_id: 'westo-demo',
          domain_kind: 'neem_subdomain',
          verification_status: 'verified',
          tls_mode: 'managed'
        }
      ],
      neem_control_audit_events: [
        {
          id: 'evt_legacy_001',
          actor_id: null,
          actor_role: null,
          action: 'SYSTEM_BOOTSTRAP_INITIALIZED',
          target_type: 'platform',
          target_id: 'neem_core',
          tenant_id: null,
          request_id: 'req_init_legacy',
          metadata: { note: 'رویداد سیستمی بدون کنشگر مشخص' },
          client_ip: '127.0.0.1',
          user_agent: 'neem-init',
          occurred_at: new Date('2024-01-01T00:00:00Z')
        },
        {
          id: 'evt_seed_002',
          actor_id: 'usr_platform_owner',
          actor_role: 'platform_owner',
          action: 'PLATFORM_POLICY_PUBLISHED',
          target_type: 'policy_bundle',
          target_id: 'bundle_v1',
          tenant_id: 'westo-demo',
          request_id: 'req_init_owner',
          metadata: { version: '1.0.0' },
          client_ip: '127.0.0.1',
          user_agent: 'neem-init',
          occurred_at: new Date('2024-01-02T00:00:00Z')
        }
      ],
      neem_audit_export_cursors: [],
      neem_control_migrations: [],
      neem_commercial_grants: [
        {
          id: 'grnt_seed_01',
          tenant_id: 'westo-demo',
          feature_key: 'core.workspace',
          grant_kind: 'perpetual',
          duration_months: null,
          issued_at: new Date('2026-01-01').toISOString(),
          expires_at: null,
          is_active: true,
          actor_id: 'system',
          metadata: { note: 'پایه فضای کاری' }
        },
        {
          id: 'grnt_seed_02',
          tenant_id: 'westo-demo',
          feature_key: 'catalog.menu',
          grant_kind: 'perpetual',
          duration_months: null,
          issued_at: new Date('2026-01-01').toISOString(),
          expires_at: null,
          is_active: true,
          actor_id: 'system',
          metadata: { note: 'منوی دیجیتال' }
        },
        {
          id: 'grnt_seed_03',
          tenant_id: 'westo-demo',
          feature_key: 'orders.pos',
          grant_kind: 'commercial',
          duration_months: 12,
          issued_at: new Date('2026-01-01').toISOString(),
          expires_at: new Date('2027-01-01').toISOString(),
          is_active: true,
          actor_id: 'system',
          metadata: { note: 'صندوق فروشگاهی لمسی' }
        },
        {
          id: 'grnt_seed_04',
          tenant_id: 'westo-demo',
          feature_key: 'finance.workspace',
          grant_kind: 'commercial',
          duration_months: 12,
          issued_at: new Date('2026-01-01').toISOString(),
          expires_at: new Date('2027-01-01').toISOString(),
          is_active: true,
          actor_id: 'system',
          metadata: { note: 'حسابداری دوبل و دفاتر قانونی' }
        }
      ],
      neem_personal_overrides: [
        {
          id: 'ovr_seed_01',
          tenant_id: 'westo-demo',
          user_id: 'user-owner-1',
          permission_key: 'finance.export',
          state: 'deny',
          decision_reason: 'تعلیق موقت خروجی مالی با دستور حراست به علت بازرسی دوره‌ای',
          actor_id: 'usr_platform_owner',
          updated_at: new Date('2026-02-01').toISOString()
        }
      ],
      neem_published_policies: [],
      neem_policy_outbox: [],
      neem_provisioning_jobs: [],
      neem_tenant_resources: [
        {
          id: 'res_westo_db_01',
          tenant_id: 'westo-demo',
          resource_type: 'database',
          resource_handle: 'tenant_westo_demo',
          cell_id: 'cell-teh-01',
          status: 'ready',
          details: { provider: 'postgres', port: 5432, schemaVersion: '1.0.0' },
          created_at: new Date('2024-06-01'),
          updated_at: new Date('2024-06-01')
        }
      ],
      neem_tenant_invitations: [],
      neem_tenant_backups: [],
      neem_billing_plans: [],
      neem_billing_subscriptions: [],
      neem_billing_invoices: [],
      neem_billing_transactions: [],
      neem_billing_quotas: [],
      neem_automation_rules: [],
      neem_automation_rule_versions: [],
      neem_automation_executions: [],
      neem_automation_processed_keys: [],
      neem_automation_outbox: [],
      neem_cell_inbox: [],
      neem_test_counters: [],
      neem_automation_cell_states: [],
      neem_support_tickets: [],
      neem_support_ticket_messages: [],
      neem_support_sessions: [],
      neem_support_session_approvals: [],
      neem_support_approval_rate_limits: [],
      neem_pii_encryption_keys: [],
      neem_tenant_customers: getSeedTenantCustomers(),
      neem_pii_access_audit: [],
      neem_keyring_reencrypt_jobs: [],
      neem_infrastructure_domains: [],
      neem_infrastructure_certificates: [],
      neem_infrastructure_probes: [],
      neem_edge_devices: [],
      neem_edge_leases: [],
      neem_edge_sync_conflicts: [],
      neem_edge_order_receipts: [],
      neem_edge_packages: [],
      neem_backup_manifests: [],
      neem_restore_drills: [],
      neem_backup_policies: [],
      neem_releases: [],
      neem_rollout_waves: [],
      neem_incidents: [],
      neem_platform_mfa_challenges: [],
      neem_tenant_identities: [
        {
          id: 'usr_westo_owner',
          display_name: 'سهراب آریا (مالک وستو)',
          email: 'owner@westo.demo.neem.ir',
          phone: '+989121111111',
          identity_type: 'restaurant_staff',
          status: 'active',
          mfa_enabled: true,
          metadata: { title: 'مدیرعامل و مالک برند' },
          created_at: new Date('2024-06-01T00:00:00Z'),
          updated_at: new Date('2024-06-01T00:00:00Z')
        },
        {
          id: 'usr_westo_mgr',
          display_name: 'مریم فخیمی (مدیر داخلی)',
          email: 'manager@westo.demo.neem.ir',
          phone: '+989122222222',
          identity_type: 'restaurant_staff',
          status: 'active',
          mfa_enabled: true,
          metadata: { title: 'مدیر شعبه مرکزی' },
          created_at: new Date('2024-06-05T00:00:00Z'),
          updated_at: new Date('2024-06-05T00:00:00Z')
        },
        {
          id: 'usr_westo_cashier_01',
          display_name: 'علی کاظمی (صندوقدار)',
          email: 'cashier1@westo.demo.neem.ir',
          phone: '+989123333333',
          identity_type: 'restaurant_staff',
          status: 'active',
          mfa_enabled: false,
          metadata: { title: 'صندوقدار شیفت عصر' },
          created_at: new Date('2024-06-10T00:00:00Z'),
          updated_at: new Date('2024-06-10T00:00:00Z')
        },
        {
          id: 'usr_shiraz_owner',
          display_name: 'کوروش زند (مالک بیسترو)',
          email: 'owner@bistrot.demo.neem.ir',
          phone: '+989171111111',
          identity_type: 'restaurant_staff',
          status: 'active',
          mfa_enabled: true,
          metadata: { title: 'مالک و مدیر اجرایی' },
          created_at: new Date('2024-07-01T00:00:00Z'),
          updated_at: new Date('2024-07-01T00:00:00Z')
        }
      ],
      neem_tenant_memberships: [
        {
          id: 'mem_westo_01',
          tenant_id: 'westo-demo',
          identity_id: 'usr_westo_owner',
          role: 'owner',
          branch_scope: '*',
          status: 'active',
          active_sessions: 2,
          invited_at: new Date('2024-06-01T00:00:00Z'),
          accepted_at: new Date('2024-06-01T00:00:00Z'),
          revoked_at: null,
          invited_by: 'system',
          revoked_by: null,
          metadata: { activeSessions: 2 },
          created_at: new Date('2024-06-01T00:00:00Z'),
          updated_at: new Date('2024-06-01T00:00:00Z')
        },
        {
          id: 'mem_westo_02',
          tenant_id: 'westo-demo',
          identity_id: 'usr_westo_mgr',
          role: 'manager',
          branch_scope: '*',
          status: 'active',
          active_sessions: 1,
          invited_at: new Date('2024-06-05T00:00:00Z'),
          accepted_at: new Date('2024-06-05T00:00:00Z'),
          revoked_at: null,
          invited_by: 'usr_westo_owner',
          revoked_by: null,
          metadata: { activeSessions: 1 },
          created_at: new Date('2024-06-05T00:00:00Z'),
          updated_at: new Date('2024-06-05T00:00:00Z')
        },
        {
          id: 'mem_westo_03',
          tenant_id: 'westo-demo',
          identity_id: 'usr_westo_cashier_01',
          role: 'cashier',
          branch_scope: 'br_central',
          status: 'active',
          active_sessions: 1,
          invited_at: new Date('2024-06-10T00:00:00Z'),
          accepted_at: new Date('2024-06-10T00:00:00Z'),
          revoked_at: null,
          invited_by: 'usr_westo_mgr',
          revoked_by: null,
          metadata: { activeSessions: 1 },
          created_at: new Date('2024-06-10T00:00:00Z'),
          updated_at: new Date('2024-06-10T00:00:00Z')
        },
        {
          id: 'mem_shiraz_01',
          tenant_id: 'shiraz-bistrot',
          identity_id: 'usr_shiraz_owner',
          role: 'owner',
          branch_scope: '*',
          status: 'active',
          active_sessions: 1,
          invited_at: new Date('2024-07-01T00:00:00Z'),
          accepted_at: new Date('2024-07-01T00:00:00Z'),
          revoked_at: null,
          invited_by: 'system',
          revoked_by: null,
          metadata: { activeSessions: 1 },
          created_at: new Date('2024-07-01T00:00:00Z'),
          updated_at: new Date('2024-07-01T00:00:00Z')
        }
      ]
    };
    this.auditPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this.transactionSnapshot = null;
  }

  async query(text, params = []) {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    // Transaction Management
    if (upper === 'BEGIN') {
      this.transactionSnapshot = JSON.parse(JSON.stringify(this.tables));
      return { rows: [] };
    }
    if (upper === 'COMMIT') {
      this.transactionSnapshot = null;
      return { rows: [] };
    }
    if (upper === 'ROLLBACK') {
      if (this.transactionSnapshot) {
        this.tables = this.transactionSnapshot;
        this.transactionSnapshot = null;
      }
      return { rows: [] };
    }

    // Enforce Immutability Trigger on Audit Table
    if ((upper.startsWith('UPDATE') || upper.startsWith('DELETE')) && trimmed.includes('neem_control_audit_events')) {
      throw new Error('Audit events are strictly append-only: UPDATE or DELETE is prohibited.');
    }

    // --- Query Handling for Principals ---
    if (upper.includes('FROM NEEM_PLATFORM_PRINCIPALS')) {
      if (upper.includes('COUNT(*)')) {
        return { rows: [{ count: String(this.tables.neem_platform_principals.length) }] };
      }
      if (upper.includes('WHERE EMAIL =') || upper.includes('WHERE LOWER(EMAIL) =')) {
        const email = (params[0] || '').toLowerCase();
        const found = this.tables.neem_platform_principals.find(p => p.email.toLowerCase() === email);
        return { rows: found ? [found] : [] };
      }
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const found = this.tables.neem_platform_principals.find(p => p.id === id);
        return { rows: found ? [found] : [] };
      }
      return { rows: [...this.tables.neem_platform_principals] };
    }

    if (upper.startsWith('INSERT INTO NEEM_PLATFORM_PRINCIPALS')) {
      const p = {
        id: params[0],
        email: params[1],
        full_name: params[2],
        role: params[3],
        password_hash: params[4],
        status: params[5] || 'active',
        failed_login_attempts: 0,
        locked_until: null,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_platform_principals.push(p);
      return { rows: [p] };
    }

    if (upper.startsWith('UPDATE NEEM_PLATFORM_PRINCIPALS')) {
      if (upper.includes('FAILED_LOGIN_ATTEMPTS = FAILED_LOGIN_ATTEMPTS + 1')) {
        const id = params[0];
        const p = this.tables.neem_platform_principals.find(x => x.id === id || x.email === id);
        if (p) {
          p.failed_login_attempts = (p.failed_login_attempts || 0) + 1;
          const maxAttempts = Number(params[1]) || config.maxLoginAttempts;
          const lockoutMins = Number(params[2]) || config.lockoutMinutes;
          if (p.failed_login_attempts >= maxAttempts) {
            p.locked_until = new Date(Date.now() + lockoutMins * 60 * 1000);
          }
        }
        return { rows: p ? [p] : [] };
      }
      if (upper.includes('SET FAILED_LOGIN_ATTEMPTS = 0')) {
        const p = this.tables.neem_platform_principals.find(x => x.id === params[params.length - 1]);
        if (p) {
          p.failed_login_attempts = 0;
          p.locked_until = null;
        }
        return { rows: p ? [p] : [] };
      }
    }

    // --- MFA Factors ---
    if (upper.includes('FROM NEEM_PLATFORM_MFA_FACTORS')) {
      if (upper.includes('WHERE PRINCIPAL_ID =')) {
        const principalId = params[0];
        const rows = this.tables.neem_platform_mfa_factors.filter(m => m.principal_id === principalId);
        return { rows };
      }
    }

    if (upper.startsWith('INSERT INTO NEEM_PLATFORM_MFA_FACTORS')) {
      const f = {
        id: params[0],
        principal_id: params[1],
        factor_kind: params[2],
        secret_ciphertext: params[3],
        status: params[4] || 'pending_verification',
        created_at: new Date(),
        verified_at: params[4] === 'active' ? new Date() : null
      };
      this.tables.neem_platform_mfa_factors.push(f);
      return { rows: [f] };
    }

    if (upper.startsWith('UPDATE NEEM_PLATFORM_MFA_FACTORS')) {
      const f = this.tables.neem_platform_mfa_factors.find(x => x.id === params[1] || x.principal_id === params[1]);
      if (f) {
        f.status = params[0];
        f.verified_at = new Date();
      }
      return { rows: f ? [f] : [] };
    }

    // --- Recovery Codes ---
    if (upper.includes('FROM NEEM_PLATFORM_RECOVERY_CODES')) {
      if (upper.includes('WHERE PRINCIPAL_ID =') && upper.includes('CODE_HASH =')) {
        const pId = params[0];
        const hash = params[1];
        const onlyUnused = upper.includes('IS_USED = FALSE');
        const found = this.tables.neem_platform_recovery_codes.find(c => 
          c.principal_id === pId && c.code_hash === hash && (!onlyUnused || !c.is_used)
        );
        return { rows: found ? [found] : [] };
      }
    }

    if (upper.startsWith('INSERT INTO NEEM_PLATFORM_RECOVERY_CODES')) {
      const code = {
        id: params[0],
        principal_id: params[1],
        code_hash: params[2],
        is_used: false,
        used_at: null,
        created_at: new Date()
      };
      this.tables.neem_platform_recovery_codes.push(code);
      return { rows: [code] };
    }

    if (upper.startsWith('UPDATE NEEM_PLATFORM_RECOVERY_CODES')) {
      const codeId = params[0];
      const onlyUnused = upper.includes('IS_USED = FALSE');
      const found = this.tables.neem_platform_recovery_codes.find(c => c.id === codeId && (!onlyUnused || !c.is_used));
      if (found) {
        found.is_used = true;
        found.used_at = new Date();
      }
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }

    // --- MFA Challenges ---
    if (upper.startsWith('INSERT INTO NEEM_PLATFORM_MFA_CHALLENGES')) {
      const ch = {
        id: params[0],
        principal_id: params[1],
        token_hash: params[2],
        expires_at: params[3],
        is_used: false,
        failed_attempts: 0,
        locked_until: null,
        used_at: null,
        created_at: new Date()
      };
      this.tables.neem_platform_mfa_challenges.push(ch);
      return { rows: [ch] };
    }

    if (upper.includes('FROM NEEM_PLATFORM_MFA_CHALLENGES')) {
      if (upper.includes('WHERE TOKEN_HASH =')) {
        const hash = params[0];
        const ch = this.tables.neem_platform_mfa_challenges.find(c => c.token_hash === hash && !c.is_used);
        return { rows: ch ? [ch] : [] };
      }
      return { rows: [...this.tables.neem_platform_mfa_challenges] };
    }

    if (upper.startsWith('UPDATE NEEM_PLATFORM_MFA_CHALLENGES')) {
      const byId = upper.includes('WHERE ID =');
      const onlyUnused = upper.includes('IS_USED = FALSE');
      const found = this.tables.neem_platform_mfa_challenges.find(c =>
        (byId ? c.id === params[0] : c.token_hash === params[0]) && (!onlyUnused || !c.is_used)
      );
      if (upper.includes('SET FAILED_ATTEMPTS = FAILED_ATTEMPTS + 1')) {
        if (found) {
          found.failed_attempts = Number(found.failed_attempts || 0) + 1;
          if (found.failed_attempts >= Number(params[1])) {
            found.locked_until = new Date(Date.now() + Number(params[2]) * 60 * 1000);
          }
        }
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (upper.includes('SET IS_USED = TRUE')) {
        if (found) {
          found.is_used = true;
          found.used_at = new Date();
        }
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
    }

    // --- Sessions ---
    if (upper.startsWith('DELETE FROM NEEM_PLATFORM_SESSIONS')) {
      const cutoff = params[0] ? new Date(params[0]) : new Date();
      const before = this.tables.neem_platform_sessions.length;
      this.tables.neem_platform_sessions = this.tables.neem_platform_sessions.filter((session) => {
        const revoked = Boolean(session.revoked_at);
        const expired = session.expires_at && new Date(session.expires_at) <= cutoff;
        return !(revoked || expired);
      });
      return { rows: [], rowCount: before - this.tables.neem_platform_sessions.length };
    }

    if (upper.includes('FROM NEEM_PLATFORM_SESSIONS')) {
      if (upper.includes('WHERE TOKEN_HASH =')) {
        const hash = params[0];
        const s = this.tables.neem_platform_sessions.find(x => x.token_hash === hash);
        return { rows: s ? [s] : [] };
      }
    }

    if (upper.startsWith('INSERT INTO NEEM_PLATFORM_SESSIONS')) {
      const s = {
        id: params[0],
        principal_id: params[1],
        token_hash: params[2],
        client_ip: params[3],
        user_agent: params[4],
        expires_at: params[5],
        revoked_at: null,
        created_at: new Date()
      };
      this.tables.neem_platform_sessions.push(s);
      return { rows: [s] };
    }

    if (upper.startsWith('UPDATE NEEM_PLATFORM_SESSIONS')) {
      if (upper.includes('REVOKED_AT')) {
        const id = params[1] || params[0];
        const s = this.tables.neem_platform_sessions.find(x => x.id === id || x.token_hash === id);
        if (s) s.revoked_at = new Date();
        return { rows: s ? [s] : [] };
      }
    }

    // --- Tenants ---
    if (upper.includes('FROM NEEM_TENANTS')) {
      if (upper.includes('COUNT(*)')) {
        return { rows: [{ count: String(this.tables.neem_tenants.length) }] };
      }
      if (upper.includes('WHERE TENANT_ID =') || upper.includes('WHERE ID =')) {
        const id = params[0];
        const t = this.tables.neem_tenants.find(x => x.tenant_id === id || x.id === id);
        return { rows: t ? [t] : [] };
      }
      return { rows: [...this.tables.neem_tenants] };
    }

    if (upper.startsWith('INSERT INTO NEEM_TENANTS')) {
      const match = text.match(/INSERT\s+INTO\s+neem_tenants\s*\(([^)]+)\)/i);
      const colMap = {};
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          colMap[col] = params[idx];
        });
      }
      const safeJson = (v) => {
        if (!v) return {};
        if (typeof v === 'object') return v;
        try { return JSON.parse(v); } catch { return {}; }
      };
      const existing = this.tables.neem_tenants.find(x => x.tenant_id === (colMap.tenant_id || params[0]));
      if (existing && upper.includes('DO NOTHING')) {
        return { rows: [existing] };
      }
      const t = {
        tenant_id: colMap.tenant_id || params[0],
        display_name: colMap.display_name || params[1],
        status: colMap.status || params[2] || 'provisioning',
        plan_code: colMap.plan_code || params[3] || 'starter',
        cell_id: colMap.cell_id || params[4] || 'cell-teh-01',
        database_name: colMap.database_name || params[5],
        database_provider: colMap.database_provider || params[6] || 'postgres',
        canonical_domain: colMap.canonical_domain || params[7],
        metadata: safeJson(colMap.metadata || params[8]),
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_tenants.push(t);
      return { rows: [t] };
    }

    if (upper.startsWith('UPDATE NEEM_TENANTS')) {
      let tenantId = null;
      let newStatus = null;
      let expectedVersion = null;
      const incrementVersion = upper.includes('VERSION = VERSION + 1');

      // Check for WHERE tenant_id = $X AND version = $Y
      const verWhereMatch = upper.match(/WHERE\s+TENANT_ID\s*=\s*\$(\d+)\s+AND\s+VERSION\s*=\s*\$(\d+)/i);
      if (verWhereMatch) {
        tenantId = params[Number(verWhereMatch[1]) - 1];
        expectedVersion = Number(params[Number(verWhereMatch[2]) - 1]);
      } else {
        const idWhereMatch = upper.match(/WHERE\s+TENANT_ID\s*=\s*\$(\d+)/i);
        if (idWhereMatch) {
          tenantId = params[Number(idWhereMatch[1]) - 1];
        } else if (params.length > 0) {
          tenantId = params[params.length - 1];
        }
      }

      const statusParamMatch = upper.match(/SET\s+STATUS\s*=\s*\$(\d+)/i);
      if (statusParamMatch) {
        newStatus = params[Number(statusParamMatch[1]) - 1];
      } else if (upper.includes("SET STATUS = 'ACTIVE'")) {
        newStatus = 'active';
      } else if (upper.includes("SET STATUS = 'SUSPENDED'")) {
        newStatus = 'suspended';
      } else if (upper.includes("SET STATUS = 'QUARANTINED'")) {
        newStatus = 'quarantined';
      }

      const t = this.tables.neem_tenants.find(x => x.tenant_id === tenantId);
      if (!t) {
        return { rows: [], rowCount: 0 };
      }

      // Check version CAS if expectedVersion was specified
      if (expectedVersion !== null && (t.version || 1) !== expectedVersion) {
        return { rows: [], rowCount: 0 };
      }

      if (newStatus) {
        t.status = newStatus;
      }
      if (incrementVersion) {
        t.version = (t.version || 1) + 1;
      }
      t.updated_at = new Date();
      return { rows: [t], rowCount: 1 };
    }

    // --- Audit Events ---
    if (upper.startsWith('INSERT INTO NEEM_CONTROL_AUDIT_EVENTS')) {
      const match = text.match(/INSERT\s+INTO\s+neem_control_audit_events\s*\(([^)]+)\)/i);
      const colMap = {};
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          colMap[col] = params[idx];
        });
      }

      const id = colMap.id || params[0];
      const actorId = (colMap.actor_id !== undefined) ? colMap.actor_id : params[1];
      const actorRole = (colMap.actor_role !== undefined) ? colMap.actor_role : params[2];
      const action = colMap.action || params[3];
      const targetType = colMap.target_type || params[4];
      const targetId = colMap.target_id || params[5];
      const tenantId = (colMap.tenant_id !== undefined) ? colMap.tenant_id : params[6];
      const requestId = (colMap.request_id !== undefined) ? colMap.request_id : params[7];
      const metadata = colMap.metadata || params[8] || {};
      const clientIp = colMap.client_ip || params[9] || '127.0.0.1';
      const userAgent = colMap.user_agent || params[10] || 'test';
      const occurredAt = colMap.occurred_at ? new Date(colMap.occurred_at) : new Date();

      const eventPayloadStr = JSON.stringify({
        actor_id: actorId,
        actor_role: actorRole,
        action,
        target_type: targetType,
        target_id: targetId,
        tenant_id: tenantId,
        request_id: requestId,
        metadata
      });
      const eventHash = sha256(this.auditPrevHash + ':' + eventPayloadStr);

      const evt = {
        id,
        actor_id: actorId,
        actor_role: actorRole,
        action,
        target_type: targetType,
        target_id: targetId,
        tenant_id: tenantId,
        request_id: requestId,
        metadata,
        client_ip: clientIp,
        user_agent: userAgent,
        prev_hash: this.auditPrevHash,
        event_hash: eventHash,
        occurred_at: occurredAt
      };
      this.auditPrevHash = eventHash;
      this.tables.neem_control_audit_events.push(evt);
      return { rows: [evt] };
    }

    if (upper.includes('FROM NEEM_AUDIT_EXPORT_CURSORS')) {
      if (upper.includes('WHERE ID =')) {
        const row = this.tables.neem_audit_export_cursors.find((item) => item.id === params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      return { rows: this.tables.neem_audit_export_cursors.map((item) => ({ ...item })) };
    }

    if (upper.startsWith('INSERT INTO NEEM_AUDIT_EXPORT_CURSORS')) {
      const existing = this.tables.neem_audit_export_cursors.find((item) => item.id === params[0]);
      const next = {
        id: params[0],
        last_exported_occurred_at: params[1],
        last_exported_id: params[2],
        last_batch_id: params[3],
        updated_at: new Date()
      };
      if (existing && upper.includes('ON CONFLICT')) Object.assign(existing, next);
      else if (!existing) this.tables.neem_audit_export_cursors.push(next);
      return { rows: [existing || next], rowCount: 1 };
    }

    if (upper.includes('FROM NEEM_CONTROL_AUDIT_EVENTS')) {
      let rows = [...this.tables.neem_control_audit_events];
      if (upper.includes('WHERE TENANT_ID =')) {
        const tId = params[0];
        rows = rows.filter(e => e.tenant_id === tId);
      }
      if (upper.includes('ORDER BY OCCURRED_AT DESC')) {
        rows.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));
      }
      if (upper.includes('ORDER BY OCCURRED_AT ASC')) {
        const cursorAt = params[0] ? new Date(params[0]).getTime() : null;
        const cursorId = String(params[1] || '');
        rows = rows
          .filter((event) => cursorAt === null || new Date(event.occurred_at || 0).getTime() > cursorAt ||
            (new Date(event.occurred_at || 0).getTime() === cursorAt && String(event.id) > cursorId))
          .sort((a, b) => {
            const timeDelta = new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0);
            return timeDelta || String(a.id).localeCompare(String(b.id));
          })
          .slice(0, Number(params[2]) || 100);
      }
      return { rows };
    }

    // --- Commercial Grants (Phase 3) ---
    if (upper.startsWith('SELECT') && (upper.includes('FROM NEEM_COMMERCIAL_GRANTS') || upper.includes('FROM NEEM_FEATURE_GRANTS'))) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const rows = this.tables.neem_commercial_grants.filter(g => g.id === id);
        return { rows: rows.map(r => ({ ...r, status: r.status || 'ACTIVE' })) };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const tId = params[0];
        let rows = this.tables.neem_commercial_grants.filter(g => g.tenant_id === tId);
        if (upper.includes('AND FEATURE_KEY')) {
          let fKey = (params && params.length > 1) ? params[1] : null;
          if (!fKey) {
            const m = text.match(/feature_key\s*=\s*'([^']+)'/i);
            if (m) fKey = m[1];
          }
          if (fKey) {
            rows = rows.filter(g => g.feature_key === fKey);
          }
        }
        return { rows: rows.map(r => ({ ...r, status: r.status || 'ACTIVE' })) };
      }
      return { rows: this.tables.neem_commercial_grants.map(r => ({ ...r, status: r.status || 'ACTIVE' })) };
    }

    if (upper.startsWith('INSERT INTO NEEM_COMMERCIAL_GRANTS') || upper.startsWith('INSERT INTO NEEM_FEATURE_GRANTS')) {
      const match = text.match(/INSERT\s+INTO\s+neem_(?:commercial|feature)_grants\s*\(([^)]+)\)/i);
      const colMap = {};
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          colMap[col] = params[idx];
        });
      }
      const id = colMap.id || params[0];
      const tenantId = colMap.tenant_id || params[1];
      const featureKey = colMap.feature_key || params[2];
      const grantKind = colMap.grant_kind || params[3];
      const expiresAt = colMap.valid_until || colMap.expires_at || params[4];
      const grantedBy = colMap.granted_by || (params.length > 5 ? params[5] : 'system');
      const metadata = colMap.metadata || (params.length > 6 ? params[6] : {});
      const status = colMap.status || 'ACTIVE';

      const existingIndex = this.tables.neem_commercial_grants.findIndex(
        g => (g.id && g.id === id) || (g.tenant_id === tenantId && g.feature_key === featureKey)
      );

      const grant = {
        id,
        tenant_id: tenantId,
        feature_key: featureKey,
        grant_kind: grantKind,
        expires_at: expiresAt,
        granted_by: grantedBy,
        metadata,
        status,
        created_at: new Date(),
        updated_at: new Date()
      };

      if (existingIndex >= 0) {
        this.tables.neem_commercial_grants[existingIndex] = {
          ...this.tables.neem_commercial_grants[existingIndex],
          ...grant
        };
        return { rows: [this.tables.neem_commercial_grants[existingIndex]] };
      } else {
        this.tables.neem_commercial_grants.push(grant);
        return { rows: [grant] };
      }
    }

    if (upper.startsWith('DELETE FROM NEEM_COMMERCIAL_GRANTS') || upper.startsWith('DELETE FROM NEEM_FEATURE_GRANTS')) {
      const tenantId = params[0];
      const featureKey = params.length > 1 ? params[1] : null;
      let removed = [];
      if (upper.includes("GRANT_KIND = 'TRIAL'")) {
        removed = this.tables.neem_commercial_grants.filter(g => g.tenant_id === tenantId && g.grant_kind === 'trial');
        this.tables.neem_commercial_grants = this.tables.neem_commercial_grants.filter(
          g => !(g.tenant_id === tenantId && g.grant_kind === 'trial')
        );
      } else if (featureKey) {
        removed = this.tables.neem_commercial_grants.filter(g => g.tenant_id === tenantId && g.feature_key === featureKey);
        this.tables.neem_commercial_grants = this.tables.neem_commercial_grants.filter(
          g => !(g.tenant_id === tenantId && g.feature_key === featureKey)
        );
      } else {
        removed = this.tables.neem_commercial_grants.filter(g => g.tenant_id === tenantId);
        this.tables.neem_commercial_grants = this.tables.neem_commercial_grants.filter(
          g => g.tenant_id !== tenantId
        );
      }
      return { rowCount: removed.length, rows: removed };
    }

    // --- Personal Overrides (Phase 3) ---
    if (upper.startsWith('DELETE FROM NEEM_PERSONAL_OVERRIDES')) {
      const tenantId = params[0];
      const userId = params[1];
      const permKey = params[2];
      this.tables.neem_personal_overrides = this.tables.neem_personal_overrides.filter(
        o => !(o.tenant_id === tenantId && o.user_id === userId && o.permission_key === permKey)
      );
      return { rows: [] };
    }

    if (upper.includes('FROM NEEM_PERSONAL_OVERRIDES')) {
      let rows = [...this.tables.neem_personal_overrides];
      if (upper.includes('WHERE TENANT_ID =')) {
        rows = rows.filter(o => o.tenant_id === params[0]);
        if (upper.includes('AND USER_ID =')) {
          rows = rows.filter(o => o.user_id === params[1]);
        }
      }
      return { rows };
    }

    if (upper.startsWith('INSERT INTO NEEM_PERSONAL_OVERRIDES')) {
      const id = params[0];
      const tenantId = params[1];
      const userId = params[2];
      const permKey = params[3];
      const state = params[4];
      const reason = params[5];
      const actorId = params[6];

      const idx = this.tables.neem_personal_overrides.findIndex(
        o => o.tenant_id === tenantId && o.user_id === userId && o.permission_key === permKey
      );

      const override = {
        id,
        tenant_id: tenantId,
        user_id: userId,
        permission_key: permKey,
        state,
        decision_reason: reason,
        actor_id: actorId,
        created_at: new Date(),
        updated_at: new Date()
      };

      if (idx >= 0) {
        this.tables.neem_personal_overrides[idx] = {
          ...this.tables.neem_personal_overrides[idx],
          state,
          decision_reason: reason,
          actor_id: actorId,
          updated_at: new Date()
        };
        return { rows: [this.tables.neem_personal_overrides[idx]] };
      } else {
        this.tables.neem_personal_overrides.push(override);
        return { rows: [override] };
      }
    }

    // --- Published Policies & Outbox (Phase 3) ---
    if (upper.startsWith('INSERT INTO NEEM_PUBLISHED_POLICIES')) {
      const record = {
        version: params[0],
        tenant_id: params[1],
        policy_payload: params[2],
        policy_hash: params[3],
        published_by: params[4],
        published_at: new Date()
      };
      this.tables.neem_published_policies.push(record);
      return { rows: [record] };
    }

    if (upper.startsWith('INSERT INTO NEEM_POLICY_OUTBOX')) {
      const item = {
        id: params[0],
        tenant_id: params[1],
        policy_version: params[2],
        target_cell: params[3],
        status: params[4] || 'pending',
        attempts: params[5] || 0,
        acked_at: null,
        created_at: new Date()
      };
      this.tables.neem_policy_outbox.push(item);
      return { rows: [item] };
    }

    if (upper.includes('FROM NEEM_POLICY_OUTBOX')) {
      let rows = [...this.tables.neem_policy_outbox];
      if (upper.includes('WHERE TENANT_ID =')) {
        rows = rows.filter(i => i.tenant_id === params[0]);
      }
      return { rows };
    }

    if (upper.startsWith('UPDATE NEEM_POLICY_OUTBOX')) {
      if (upper.includes("SET STATUS = 'ACKNOWLEDGED'")) {
        const id = params[0];
        const item = this.tables.neem_policy_outbox.find(i => i.id === id);
        if (item) {
          item.status = 'acknowledged';
          item.acked_at = new Date();
        }
        return { rows: item ? [item] : [] };
      }
    }

    // --- Provisioning Jobs (Phase 4) ---
    if (upper.startsWith('INSERT INTO NEEM_PROVISIONING_JOBS')) {
      const job = {
        id: params[0],
        tenant_id: params[1],
        cell_id: params[2],
        current_step: params[3],
        step_index: params[4],
        total_steps: params[5],
        status: params[6] || 'running',
        step_logs: safeJson(params[7], []),
        idempotency_key: params[8] || null,
        step_checksums: safeJson(params[9], {}),
        resource_handle: safeJson(params[10], {}),
        last_successful_step: null,
        error_message: null,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null
      };
      this.tables.neem_provisioning_jobs.push(job);
      return { rows: [job] };
    }

    if (upper.startsWith('UPDATE NEEM_PROVISIONING_JOBS')) {
      const id = params[params.length - 1];
      const job = this.tables.neem_provisioning_jobs.find(j => j.id === id);
      if (job) {
        if (upper.includes('CURRENT_STEP =') && upper.includes('STEP_INDEX =')) {
          job.current_step = params[0];
          job.step_index = params[1];
          job.updated_at = new Date();
        }
        if (upper.includes("SET STATUS = 'FAILED'")) {
          job.status = 'failed';
          job.error_message = params[0];
          job.step_logs = safeJson(params[1], []);
          job.last_successful_step = params[2];
          if (params[3]) {
            try { job.resource_handle = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3]; } catch { job.resource_handle = params[3]; }
          }
          job.updated_at = new Date();
        } else if (upper.includes('LAST_SUCCESSFUL_STEP =')) {
          job.last_successful_step = params[0];
          if (params[1]) {
            try { job.step_checksums = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]; } catch { job.step_checksums = params[1]; }
          }
          if (params[2]) {
            try { job.resource_handle = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2]; } catch { job.resource_handle = params[2]; }
          }
          job.updated_at = new Date();
        }
        if (upper.includes("SET STATUS = 'COMPLETED'")) {
          job.status = 'completed';
          job.step_logs = safeJson(params[0], []);
          job.completed_at = new Date();
          job.updated_at = new Date();
        }
        if (upper.includes("SET STATUS = 'RUNNING'")) {
          job.status = 'running';
          job.error_message = null;
          job.updated_at = new Date();
        }
        if (upper.includes("SET STATUS = 'QUARANTINED'")) {
          job.status = 'quarantined';
          job.error_message = params[0];
          job.updated_at = new Date();
        }
      }
      return { rows: job ? [job] : [] };
    }

    if (upper.includes('FROM NEEM_PROVISIONING_JOBS')) {
      if (upper.includes('WHERE IDEMPOTENCY_KEY =')) {
        const key = params[0];
        const j = this.tables.neem_provisioning_jobs.find(x => x.idempotency_key === key);
        return { rows: j ? [j] : [] };
      }
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const j = this.tables.neem_provisioning_jobs.find(x => x.id === id);
        return { rows: j ? [j] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const tid = params[0];
        const rows = this.tables.neem_provisioning_jobs.filter(x => x.tenant_id === tid);
        return { rows };
      }
      return { rows: [...this.tables.neem_provisioning_jobs] };
    }

    // --- Tenant Resources (Phase 4) ---
    if (upper.startsWith('UPDATE NEEM_TENANT_RESOURCES')) {
      if (upper.includes("SET STATUS = 'QUARANTINED'")) {
        const tid = params[0];
        this.tables.neem_tenant_resources.forEach(r => {
          if (r.tenant_id === tid) {
            r.status = 'quarantined';
            r.updated_at = new Date();
          }
        });
      }
      return { rows: [] };
    }

    if (upper.startsWith('INSERT INTO NEEM_TENANT_RESOURCES')) {
      const res = {
        id: params[0],
        tenant_id: params[1],
        resource_type: params[2],
        resource_handle: params[3],
        cell_id: params[4],
        status: params[5] || 'ready',
        details: safeJson(params[6], {}),
        created_at: new Date(),
        updated_at: new Date()
      };
      const idx = this.tables.neem_tenant_resources.findIndex(r => r.id === res.id);
      if (idx >= 0) {
        this.tables.neem_tenant_resources[idx] = { ...this.tables.neem_tenant_resources[idx], ...res, updated_at: new Date() };
      } else {
        this.tables.neem_tenant_resources.push(res);
      }
      return { rows: [res] };
    }

    if (upper.includes('FROM NEEM_TENANT_RESOURCES')) {
      let rows = [...this.tables.neem_tenant_resources];
      if (upper.includes('WHERE TENANT_ID =')) {
        const tid = params[0];
        rows = rows.filter(r => r.tenant_id === tid);
      }
      if (upper.includes("RESOURCE_TYPE = 'DATABASE'")) {
        rows = rows.filter(r => r.resource_type === 'database');
      } else if (upper.includes("RESOURCE_TYPE = 'STORAGE'")) {
        rows = rows.filter(r => r.resource_type === 'storage');
      }
      return { rows };
    }

    // --- Tenant Invitations (Phase 4) ---
    if (upper.startsWith('INSERT INTO NEEM_TENANT_INVITATIONS')) {
      const inv = {
        id: params[0],
        tenant_id: params[1],
        email: params[2],
        phone: params[3],
        role: params[4] || 'owner',
        token_hash: params[5],
        status: params[6] || 'pending',
        expires_at: params[7],
        created_by: params[8],
        accepted_at: null,
        created_at: new Date()
      };
      this.tables.neem_tenant_invitations.push(inv);
      return { rows: [inv] };
    }

    if (upper.includes('FROM NEEM_TENANT_INVITATIONS')) {
      if (upper.includes('WHERE TOKEN_HASH =')) {
        const hash = params[0];
        const inv = this.tables.neem_tenant_invitations.find(i => i.token_hash === hash && i.status === 'pending');
        return { rows: inv ? [inv] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const tId = params[0];
        const rows = this.tables.neem_tenant_invitations.filter(i => i.tenant_id === tId);
        return { rows };
      }
      return { rows: [...this.tables.neem_tenant_invitations] };
    }

    if (upper.startsWith('UPDATE NEEM_TENANT_INVITATIONS')) {
      if (upper.includes("SET STATUS = 'ACCEPTED'")) {
        const id = params[0];
        const inv = this.tables.neem_tenant_invitations.find(i => i.id === id);
        if (inv) {
          inv.status = 'accepted';
          inv.accepted_at = new Date();
        }
        return { rows: inv ? [inv] : [] };
      }
    }

    // --- Tenant Backups (Phase 4) ---
    if (upper.startsWith('INSERT INTO NEEM_TENANT_BACKUPS')) {
      const bck = {
        id: params[0],
        tenant_id: params[1],
        backup_kind: params[2],
        storage_uri: params[3],
        checksum_sha256: params[4],
        size_bytes: params[5] || 0,
        status: params[6] || 'verified',
        metadata: safeJson(params[7], {}),
        created_at: new Date()
      };
      this.tables.neem_tenant_backups.push(bck);
      return { rows: [bck] };
    }

    if (upper.includes('FROM NEEM_TENANT_BACKUPS')) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const b = this.tables.neem_tenant_backups.find(x => x.id === id);
        return { rows: b ? [b] : [] };
      }
      return { rows: [...this.tables.neem_tenant_backups] };
    }

    if (upper.startsWith('UPDATE NEEM_TENANT_BACKUPS')) {
      if (upper.includes("SET STATUS = 'RESTORED'")) {
        const id = params[0];
        const b = this.tables.neem_tenant_backups.find(x => x.id === id);
        if (b) b.status = 'restored';
        return { rows: b ? [b] : [] };
      }
    }

    // --- Billing Plans (Phase 5 / GM-10) ---
    if (upper.startsWith('INSERT INTO NEEM_BILLING_PLANS')) {
      const plan = {
        plan_code: params[0],
        name_fa: params[1],
        base_price_monthly_rials: params[2] || 0,
        included_branches: params[3] || 1,
        included_devices: params[4] || 2,
        features: safeJson(params[5], []),
        is_active: params[6] !== undefined ? params[6] : true,
        created_at: new Date()
      };
      this.tables.neem_billing_plans.push(plan);
      return { rows: [plan] };
    }

    if (upper.includes('FROM NEEM_BILLING_PLANS')) {
      if (upper.includes('WHERE PLAN_CODE =')) {
        const p = this.tables.neem_billing_plans.find(x => x.plan_code === params[0]);
        return { rows: p ? [p] : [] };
      }
      return { rows: [...this.tables.neem_billing_plans] };
    }

    // --- Billing Subscriptions (Phase 5 / GM-11) ---
    if (upper.startsWith('INSERT INTO NEEM_BILLING_SUBSCRIPTIONS')) {
      const match = text.match(/INSERT\s+INTO\s+neem_billing_subscriptions\s*\(([^)]+)\)/i);
      const colMap = {};
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          colMap[col] = params[idx];
        });
      }
      const sub = {
        id: colMap.id || params[0],
        tenant_id: colMap.tenant_id || params[1],
        plan_code: colMap.plan_code || params[2] || 'standard',
        status: colMap.status || params[3] || 'active',
        billing_cycle: colMap.billing_cycle || params[4] || 'monthly',
        current_period_start: colMap.current_period_start || (params[5] ? new Date(params[5]) : new Date()),
        current_period_end: colMap.current_period_end || (params[6] ? new Date(params[6]) : new Date(Date.now() + 30 * 86400000)),
        cancel_at_period_end: colMap.cancel_at_period_end || params[7] || false,
        version: 1,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_billing_subscriptions.push(sub);
      return { rows: [sub] };
    }

    if (upper.includes('FROM NEEM_BILLING_SUBSCRIPTIONS')) {
      if (upper.includes('WHERE TENANT_ID =')) {
        const rows = this.tables.neem_billing_subscriptions.filter(s => s.tenant_id === params[0]);
        return { rows };
      }
      if (upper.includes('WHERE ID =')) {
        const sub = this.tables.neem_billing_subscriptions.find(s => s.id === params[0]);
        return { rows: sub ? [sub] : [] };
      }
      return { rows: [...this.tables.neem_billing_subscriptions] };
    }

    if (upper.startsWith('UPDATE NEEM_BILLING_SUBSCRIPTIONS')) {
      const id = params[params.length - 1];
      const sub = this.tables.neem_billing_subscriptions.find(s => s.id === id);
      if (sub) {
        if (upper.includes("SET STATUS =")) sub.status = params[0];
        if (upper.includes('VERSION = VERSION + 1')) {
          sub.version = (sub.version || 1) + 1;
        }
        sub.updated_at = new Date();
      }
      return { rows: sub ? [sub] : [], rowCount: sub ? 1 : 0 };
    }

    // --- Billing Invoices (Phase 5) ---
    if (upper.startsWith('INSERT INTO NEEM_BILLING_INVOICES')) {
      const match = text.match(/INSERT\s+INTO\s+neem_billing_invoices\s*\(([^)]+)\)/i);
      const colMap = {};
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          colMap[col] = params[idx];
        });
      }
      const inv = {
        id: colMap.id || params[0],
        tenant_id: colMap.tenant_id || params[1],
        amount_subtotal_rials: colMap.amount_subtotal_rials || colMap.amount_due || colMap.amount || params[2] || 0,
        vat_amount_rials: colMap.vat_amount_rials || params[3] || 0,
        discount_amount_rials: colMap.discount_amount_rials || params[4] || 0,
        amount_total_rials: colMap.amount_total_rials || colMap.amount_due || colMap.amount || params[5] || params[2] || 0,
        amount: colMap.amount || colMap.amount_due || params[2] || 0,
        amount_due: colMap.amount_due || colMap.amount || params[2] || 0,
        currency: colMap.currency || params[3] || 'IRR',
        status: colMap.status || params[6] || params[4] || 'unpaid',
        due_date: colMap.due_date || params[7] || new Date(),
        metadata: safeJson(colMap.metadata, {}),
        line_items: [],
        paid_at: null,
        settled_at: null,
        version: 1,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_billing_invoices.push(inv);
      return { rows: [inv] };
    }

    if (upper.startsWith('UPDATE NEEM_BILLING_INVOICES')) {
      let id = params[params.length - 1];
      let inv = this.tables.neem_billing_invoices.find(i => i.id === id);
      if (!inv && params.length >= 2) {
        inv = this.tables.neem_billing_invoices.find(i => i.id === params[1] || i.id === params[params.length - 2]);
      }
      if (inv) {
        if (upper.includes('SET METADATA =')) {
          const metaVal = safeJson(params[0], {});
          inv.metadata = metaVal;
        }
        if (upper.includes("SET STATUS = 'PAID'") || upper.includes("SET STATUS = $")) {
          inv.status = 'paid';
          inv.paid_at = new Date();
          inv.settled_at = new Date();
        }
        if (upper.includes("SET STATUS = 'REFUNDED'")) {
          inv.status = 'refunded';
        }
        if (upper.includes('VERSION = VERSION + 1')) {
          inv.version = (inv.version || 1) + 1;
        }
        inv.updated_at = new Date();
      }
      return { rows: inv ? [inv] : [], rowCount: inv ? 1 : 0 };
    }

    if (upper.includes('FROM NEEM_BILLING_INVOICES')) {
      let rows = [...this.tables.neem_billing_invoices];
      if (upper.includes('WHERE ID =') && upper.includes('AND TENANT_ID =')) {
        const id = params[0];
        const tId = params[1];
        rows = rows.filter(i => i.id === id && i.tenant_id === tId);
        return { rows };
      }
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        rows = rows.filter(i => i.id === id);
        return { rows };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const tId = params[0];
        rows = rows.filter(i => i.tenant_id === tId);
        return { rows };
      }
      return { rows };
    }

    // --- Billing Transactions (Phase 5) ---
    if (upper.startsWith('INSERT INTO NEEM_BILLING_TRANSACTIONS')) {
      const tx = {
        id: params[0],
        invoice_id: params[1],
        tenant_id: params[2],
        idempotency_key: params[3],
        gateway_provider: params[4],
        gateway_authority: params[5],
        amount_rials: params[6],
        status: params[7] || 'pending',
        trace_number: null,
        refund_reason: null,
        refunded_at: null,
        settled_at: null,
        created_at: new Date()
      };
      this.tables.neem_billing_transactions.push(tx);
      return { rows: [tx] };
    }

    if (upper.includes('FROM NEEM_BILLING_TRANSACTIONS')) {
      if (upper.includes('WHERE IDEMPOTENCY_KEY =')) {
        const key = params[0];
        const tx = this.tables.neem_billing_transactions.find(t => t.idempotency_key === key);
        return { rows: tx ? [tx] : [] };
      }
      if (upper.includes('WHERE GATEWAY_AUTHORITY =')) {
        const auth = params[0];
        const tx = this.tables.neem_billing_transactions.find(t => t.gateway_authority === auth);
        return { rows: tx ? [tx] : [] };
      }
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const tx = this.tables.neem_billing_transactions.find(t => t.id === id);
        return { rows: tx ? [tx] : [] };
      }
      return { rows: [...this.tables.neem_billing_transactions] };
    }

    if (upper.startsWith('UPDATE NEEM_BILLING_TRANSACTIONS')) {
      const id = params[params.length - 1];
      const tx = this.tables.neem_billing_transactions.find(t => t.id === id);
      if (tx) {
        if (upper.includes("SET STATUS = 'SUCCESSFUL'")) {
          tx.status = 'successful';
          tx.trace_number = params[0];
          tx.settled_at = new Date();
        }
        if (upper.includes("SET STATUS = 'FAILED'")) {
          tx.status = 'failed';
        }
        if (upper.includes("SET STATUS = 'REFUNDED'")) {
          tx.status = 'refunded';
          tx.refund_reason = params[0];
          tx.refunded_at = new Date();
        }
      }
      return { rows: tx ? [tx] : [] };
    }

    // --- Billing Quotas (Phase 5) ---
    if (upper.includes('FROM NEEM_BILLING_QUOTAS')) {
      if (upper.includes('WHERE TENANT_ID =')) {
        const q = this.tables.neem_billing_quotas.find(x => x.tenant_id === params[0]);
        return { rows: q ? [q] : [] };
      }
      return { rows: [...this.tables.neem_billing_quotas] };
    }

    if (upper.startsWith('INSERT INTO NEEM_BILLING_QUOTAS')) {
      const tenantId = params[0];
      const maxBranches = params[1];
      const maxDevices = params[2];
      const maxUsers = params[3];
      const maxOrders = params[4];
      const maxStorageMb = params[5];
      const maxSms = params[6];

      const idx = this.tables.neem_billing_quotas.findIndex(x => x.tenant_id === tenantId);
      const prev = idx >= 0 ? this.tables.neem_billing_quotas[idx] : {};
      const quota = {
        tenant_id: tenantId,
        max_branches: maxBranches,
        max_devices: maxDevices,
        max_users: maxUsers,
        max_orders_monthly: maxOrders !== undefined ? maxOrders : (prev.max_orders_monthly ?? -1),
        max_storage_mb: maxStorageMb !== undefined ? maxStorageMb : (prev.max_storage_mb ?? 5000),
        max_sms_monthly: maxSms !== undefined ? maxSms : (prev.max_sms_monthly ?? 1000),
        current_branches: prev.current_branches ?? 1,
        current_devices: prev.current_devices ?? 1,
        current_users: prev.current_users ?? 1,
        current_orders_monthly: prev.current_orders_monthly ?? 0,
        current_storage_mb: prev.current_storage_mb ?? 120,
        current_sms_monthly: prev.current_sms_monthly ?? 45,
        updated_at: new Date()
      };

      if (idx >= 0) {
        this.tables.neem_billing_quotas[idx] = quota;
      } else {
        this.tables.neem_billing_quotas.push(quota);
      }
      return { rows: [quota] };
    }

    if (upper.startsWith('UPDATE NEEM_BILLING_QUOTAS')) {
      const match = upper.match(/SET\s+([A-Z0-9_]+)\s*=\s*\$1\s+WHERE\s+TENANT_ID\s*=\s*\$2/i);
      if (match) {
        const col = match[1].toLowerCase();
        const val = params[0];
        const tId = params[1];
        let q = this.tables.neem_billing_quotas.find(x => x.tenant_id === tId);
        if (!q) {
          q = {
            tenant_id: tId,
            max_branches: 1,
            max_devices: 2,
            max_users: 5,
            max_orders_monthly: -1,
            max_storage_mb: 5000,
            max_sms_monthly: 1000,
            current_branches: 1,
            current_devices: 1,
            current_users: 1,
            current_orders_monthly: 0,
            current_storage_mb: 120,
            current_sms_monthly: 45,
            updated_at: new Date()
          };
          this.tables.neem_billing_quotas.push(q);
        }
        q[col] = val;
        q.updated_at = new Date();
        return { rows: [q] };
      }
      return { rows: [] };
    }

    // --- Automation Rules (Phase 6) ---
    if (upper.startsWith('INSERT INTO NEEM_AUTOMATION_RULES')) {
      const match = text.match(/INSERT\s+INTO\s+neem_automation_rules\s*\(([^)]+)\)/i);
      const colMap = {};
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        const valMatch = text.match(/VALUES\s*\(([^)]+)\)/i);
        if (valMatch) {
          const valTokens = valMatch[1].split(',').map(v => v.trim());
          let paramIdx = 0;
          cols.forEach((col, idx) => {
            const token = valTokens[idx];
            if (token && token.startsWith('$')) {
              colMap[col] = params[paramIdx++];
            } else if (token) {
              colMap[col] = token.toLowerCase() === 'false' ? false : (token.toLowerCase() === 'true' ? true : token);
            }
          });
        } else {
          cols.forEach((col, idx) => {
            colMap[col] = params[idx];
          });
        }
      }
      const safeJson = (v) => {
        if (!v) return {};
        if (typeof v === 'object') return v;
        try { return JSON.parse(v); } catch { return {}; }
      };

      const id = colMap.rule_id || colMap.id || params[0];
      const name = colMap.name || params[1];
      const trigger_kind = colMap.trigger_kind || colMap.trigger_type || params[2];
      const conditions = safeJson(colMap.conditions || colMap.condition || params[3]);
      const action_payload = safeJson(colMap.action_payload || colMap.action || params[4]);
      const priority = colMap.priority !== undefined ? Number(colMap.priority) : (params[5] !== undefined && !match ? Number(params[5]) : 10);
      const version = colMap.version || (match ? 'v1' : params[6]) || 'v1';
      const description = colMap.description || (match ? '' : params[7]) || '';
      const schedule_window = safeJson(colMap.schedule_window || (match ? null : params[8]));
      const schedule_cron = colMap.schedule_cron || (match ? null : params[9]) || null;
      const is_active = colMap.is_active !== undefined ? Boolean(colMap.is_active) : true;
      const is_paused = colMap.is_paused !== undefined ? Boolean(colMap.is_paused) : false;

      const rule = {
        id,
        rule_id: id,
        name,
        trigger_kind,
        conditions,
        action_payload,
        priority,
        is_paused,
        is_active,
        version,
        description,
        schedule_window,
        schedule_cron,
        execution_count: 0,
        failure_count: 0,
        last_executed_at: null,
        created_at: new Date(),
        updated_at: new Date()
      };
      const existingIdx = this.tables.neem_automation_rules.findIndex(r => r.id === rule.id);
      if (existingIdx >= 0) {
        this.tables.neem_automation_rules[existingIdx] = {
          ...this.tables.neem_automation_rules[existingIdx],
          ...rule,
          version: version || this.tables.neem_automation_rules[existingIdx].version || 'v1',
          updated_at: new Date()
        };
        return { rows: [this.tables.neem_automation_rules[existingIdx]] };
      } else {
        this.tables.neem_automation_rules.push(rule);
        return { rows: [rule] };
      }
    }

    if (upper.startsWith('UPDATE NEEM_AUTOMATION_RULES')) {
      // Could be pause, or execution counter bump, or edit
      if (upper.includes('SET IS_PAUSED =')) {
        const id = params[1];
        const rule = this.tables.neem_automation_rules.find(r => r.id === id);
        if (rule) {
          rule.is_paused = params[0];
          rule.is_active = !params[0];
          rule.updated_at = new Date();
        }
        return { rows: rule ? [rule] : [] };
      }
      if (upper.includes('EXECUTION_COUNT')) {
        const id = params[params.length - 1];
        const rule = this.tables.neem_automation_rules.find(r => r.id === id);
        if (rule) {
          rule.execution_count = (rule.execution_count || 0) + 1;
          rule.last_executed_at = new Date();
          if (upper.includes('FAILURE_COUNT = FAILURE_COUNT + 1')) {
            rule.failure_count = (rule.failure_count || 0) + 1;
          }
          rule.updated_at = new Date();
        }
        return { rows: rule ? [rule] : [] };
      }
      const id = params[params.length - 1];
      const rule = this.tables.neem_automation_rules.find(r => r.id === id);
      if (rule) {
        rule.updated_at = new Date();
      }
      return { rows: rule ? [rule] : [] };
    }

    if (upper.includes('FROM NEEM_AUTOMATION_RULES')) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const rule = this.tables.neem_automation_rules.find(r => r.id === id);
        return { rows: rule ? [{ ...rule }] : [] };
      }
      return { rows: [...this.tables.neem_automation_rules].map(r => ({ ...r })) };
    }

    // --- Automation Rule Versions (GM-16 Audit & History) ---
    if (upper.startsWith('INSERT INTO NEEM_AUTOMATION_RULE_VERSIONS')) {
      const ver = {
        id: params[0],
        rule_id: params[1],
        version: params[2],
        snapshot: safeJson(params[3], {}),
        created_at: new Date(),
        created_by: params[4] || 'platform_system'
      };
      this.tables.neem_automation_rule_versions.push(ver);
      return { rows: [ver] };
    }

    if (upper.includes('FROM NEEM_AUTOMATION_RULE_VERSIONS')) {
      if (upper.includes('WHERE RULE_ID =')) {
        const ruleId = params[0];
        const rows = this.tables.neem_automation_rule_versions.filter(v => v.rule_id === ruleId);
        return { rows: rows.map(r => ({ ...r })) };
      }
      return { rows: [...this.tables.neem_automation_rule_versions].map(r => ({ ...r })) };
    }

    // --- Automation Executions (GM-16 Timeline & Audit) ---
    if (upper.startsWith('INSERT INTO NEEM_AUTOMATION_EXECUTIONS')) {
      const safeParse = (v) => {
        if (!v) return null;
        if (typeof v === 'object') return v;
        try { return JSON.parse(v); } catch { return v; }
      };
      const exec = {
        id: params[0],
        rule_id: params[1],
        rule_version: params[2],
        tenant_id: params[3],
        trigger_kind: params[4],
        status: params[5],
        conditions_snapshot: safeParse(params[6]) || {},
        action_payload: safeParse(params[7]) || {},
        action_result: safeParse(params[8]),
        conflict_resolution: params[9] || null,
        error_message: params[10] || null,
        reason: params[9] || params[10] || null,
        executed_at: new Date(),
        completed_at: new Date(),
        idempotency_key: params[11] || null
      };
      if (exec.idempotency_key) {
        const existing = this.tables.neem_automation_executions.find(e => e.idempotency_key === exec.idempotency_key);
        if (existing) {
          return { rows: [existing] };
        }
      }
      this.tables.neem_automation_executions.push(exec);
      return { rows: [exec] };
    }

    if (upper.startsWith('UPDATE NEEM_AUTOMATION_EXECUTIONS')) {
      const id = params[params.length - 1];
      const exec = this.tables.neem_automation_executions.find(e => e.id === id);
      if (exec) {
        if (upper.includes('STATUS =')) exec.status = params[0];
        if (upper.includes('ACTION_RESULT =')) exec.action_result = safeJson(params[1], params[1]);
        if (upper.includes('COMPLETED_AT =')) exec.completed_at = new Date();
      }
      return { rows: exec ? [{ ...exec }] : [] };
    }

    if (upper.includes('FROM NEEM_AUTOMATION_EXECUTIONS')) {
      let rows = [...this.tables.neem_automation_executions];
      if (upper.includes('WHERE IDEMPOTENCY_KEY =')) {
        const key = params[0];
        rows = rows.filter(e => e.idempotency_key === key);
      } else if (upper.includes('WHERE TENANT_ID =')) {
        const tenantId = params[0];
        rows = rows.filter(e => e.tenant_id === tenantId);
      } else if (upper.includes('WHERE RULE_ID =')) {
        const ruleId = params[0];
        rows = rows.filter(e => e.rule_id === ruleId);
      } else if (upper.includes('WHERE ID =')) {
        const id = params[0];
        rows = rows.filter(e => e.id === id);
      }
      rows.sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
      return { rows: rows.map(r => ({ ...r })) };
    }

    // --- Durable Processed Keys (AC-28 Crash Resilience Dedup) ---
    if (upper.startsWith('INSERT INTO NEEM_AUTOMATION_PROCESSED_KEYS')) {
      const keyRecord = {
        idempotency_key: params[0],
        task_id: params[1],
        tenant_id: params[2],
        processed_at: new Date()
      };
      const existing = this.tables.neem_automation_processed_keys.find(k => k.idempotency_key === keyRecord.idempotency_key);
      if (!existing) {
        this.tables.neem_automation_processed_keys.push(keyRecord);
      }
      return { rows: [keyRecord] };
    }

    if (upper.includes('FROM NEEM_AUTOMATION_PROCESSED_KEYS')) {
      const key = params[0];
      const found = this.tables.neem_automation_processed_keys.filter(k => k.idempotency_key === key);
      return { rows: found.map(k => ({ ...k })) };
    }

    // --- Automation Outbox (Phase 6 Multi-Worker & Atomic Claim) ---
    if (upper.startsWith('INSERT INTO NEEM_AUTOMATION_OUTBOX')) {
      const existing = this.tables.neem_automation_outbox.find(x => x.id === params[0]);
      if (existing && upper.includes('DO NOTHING')) {
        return { rows: [existing] };
      }
      const task = {
        id: params[0],
        tenant_id: params[1],
        target_cell: params[2],
        event_name: params[3],
        payload: safeJson(params[4], {}),
        idempotency_key: params[5],
        status: 'pending',
        attempts: 0,
        max_attempts: params[7] !== undefined ? Number(params[7]) : 5,
        locked_until: null,
        worker_id: null,
        next_run_at: params[6] || new Date(),
        last_error: null,
        created_at: new Date(),
        acknowledged_at: null
      };
      this.tables.neem_automation_outbox.push(task);
      return { rows: [task] };
    }

    // Atomic Multi-Worker Claim Query (PostgreSQL SKIP LOCKED simulation with Fencing Token)
    if (upper.startsWith('UPDATE NEEM_AUTOMATION_OUTBOX') && (upper.includes('SKIP LOCKED') || (upper.includes("SET STATUS = 'PROCESSING'") && upper.includes('WHERE ID IN')))) {
      const lockUntil = params[0];
      const workerId = params[1];
      const leaseToken = (params.length >= 4) ? params[2] : `lease_${crypto.randomUUID().slice(0, 12)}`;
      const limit = Number(params[params.length - 1]) || 10;
      const now = new Date();

      const eligible = this.tables.neem_automation_outbox.filter(t =>
        (t.status === 'pending' || (t.status === 'processing' && t.locked_until && new Date(t.locked_until) < now)) &&
        (!t.next_run_at || new Date(t.next_run_at) <= now)
      );

      eligible.sort((a, b) => new Date(a.next_run_at || 0) - new Date(b.next_run_at || 0));
      const claimed = eligible.slice(0, limit);

      for (const task of claimed) {
        task.status = 'processing';
        task.locked_until = lockUntil;
        task.worker_id = workerId;
        task.lease_token = leaseToken;
        task.fencing_token = (Number(task.fencing_token) || 0) + 1;
        task.attempts = (task.attempts || 0) + 1;
      }

      return { rows: claimed.map(t => ({ ...t })), rowCount: claimed.length };
    }

    if (upper.startsWith('UPDATE NEEM_AUTOMATION_OUTBOX')) {
      let id = null;
      let expectedWorkerId = null;
      let expectedFencingToken = null;

      const whereIdx = upper.indexOf('WHERE');
      if (whereIdx !== -1) {
        const whereClause = text.slice(whereIdx);
        const idMatch = whereClause.match(/\bid\s*=\s*\$(\d+)/i);
        if (idMatch) {
          id = params[parseInt(idMatch[1], 10) - 1];
        } else {
          id = params[params.length - 1];
        }

        const workerMatch = whereClause.match(/\bworker_id\s*=\s*\$(\d+)/i);
        if (workerMatch) {
          expectedWorkerId = params[parseInt(workerMatch[1], 10) - 1];
        }

        const fencingMatch = whereClause.match(/\bfencing_token\s*=\s*\$(\d+)/i);
        if (fencingMatch) {
          expectedFencingToken = Number(params[parseInt(fencingMatch[1], 10) - 1]);
        }
      } else {
        id = params[params.length - 1];
      }

      const task = this.tables.neem_automation_outbox.find(t => t.id === id || t.idempotency_key === id);
      if (!task) {
        return { rows: [], rowCount: 0 };
      }

      const whereIdxFound = upper.indexOf('WHERE');
      const whereClauseStr = whereIdxFound !== -1 ? text.slice(whereIdxFound) : '';

      // Check status condition in WHERE clause
      if (whereClauseStr.includes("status = 'processing'") || whereClauseStr.includes('status = $')) {
        let expectedStatus = 'processing';
        const stMatch = whereClauseStr.match(/status\s*=\s*\$(\d+)/i);
        if (stMatch) expectedStatus = params[parseInt(stMatch[1], 10) - 1];
        if (task.status !== expectedStatus) return { rows: [], rowCount: 0 };
      }

      // Fencing Token & Lease Validation: If expected worker_id or fencing_token mismatch, reject update
      if (expectedWorkerId !== null && task.worker_id !== expectedWorkerId) {
        return { rows: [], rowCount: 0 };
      }
      if (expectedFencingToken !== null && Number(task.fencing_token) !== expectedFencingToken) {
        return { rows: [], rowCount: 0 };
      }

      // Check lease validity: locked_until IS NULL OR locked_until >= now()
      if (/locked_until\s*>=\s*now\(\)|locked_until\s*>\s*now\(\)/i.test(whereClauseStr)) {
        if (task.locked_until && new Date(task.locked_until).getTime() < Date.now()) {
          return { rows: [], rowCount: 0 }; // Lease has expired!
        }
      }

      // Direct SET assignments parsing:
      const setClauseStr = whereIdxFound !== -1 ? text.slice(0, whereIdxFound) : text;

      // 1. SET worker_id
      const setWorkerMatch = setClauseStr.match(/worker_id\s*=\s*(?:'([^']+)'|\$(\d+))/i);
      if (setWorkerMatch) {
        task.worker_id = setWorkerMatch[1] !== undefined ? setWorkerMatch[1] : params[parseInt(setWorkerMatch[2], 10) - 1];
      } else if (/worker_id\s*=\s*null/i.test(setClauseStr)) {
        task.worker_id = null;
      }

      if (/lease_token\s*=\s*null/i.test(setClauseStr)) {
        task.lease_token = null;
      }

      // 2. SET fencing_token
      if (/fencing_token\s*=\s*(?:COALESCE\(fencing_token,\s*0\)|fencing_token)\s*\+\s*(\d+)/i.test(setClauseStr)) {
        const delta = parseInt(setClauseStr.match(/fencing_token\s*=\s*(?:COALESCE\(fencing_token,\s*0\)|fencing_token)\s*\+\s*(\d+)/i)[1], 10);
        task.fencing_token = (Number(task.fencing_token) || 0) + delta;
      } else {
        const fenceMatchSet = setClauseStr.match(/fencing_token\s*=\s*(?:(\d+)|\$(\d+))/i);
        if (fenceMatchSet && !fenceMatchSet[0].includes('+')) {
          task.fencing_token = fenceMatchSet[1] !== undefined ? parseInt(fenceMatchSet[1], 10) : Number(params[parseInt(fenceMatchSet[2], 10) - 1]);
        }
      }

      // 3. SET locked_until
      if (/locked_until\s*=\s*now\(\)\s*\+\s*interval\s*'([^']+)'/i.test(setClauseStr)) {
        const intStr = setClauseStr.match(/locked_until\s*=\s*now\(\)\s*\+\s*interval\s*'([^']+)'/i)[1];
        let ms = 30000;
        if (intStr.includes('second')) ms = parseInt(intStr, 10) * 1000;
        task.locked_until = new Date(Date.now() + ms);
      }

      if (upper.includes("SET STATUS = 'PROCESSING'")) {
        task.status = 'processing';
        task.locked_until = params[0];
        task.attempts = (task.attempts || 0) + 1;
        if (params.length > 2 && typeof params[1] === 'string' && params[1].startsWith('worker_')) {
          task.worker_id = params[1];
        }
      }
      if (upper.includes("SET STATUS = 'ACKNOWLEDGED'")) {
        task.status = 'acknowledged';
        task.acknowledged_at = new Date();
        task.locked_until = null;
      }
      if (upper.includes("SET STATUS = 'DEAD_LETTER'")) {
        task.status = 'dead_letter';
        task.last_error = params[0];
        task.locked_until = null;
      }
      if (upper.includes("SET STATUS = 'CANCELLED'")) {
        task.status = 'cancelled';
        task.last_error = params[0] || 'Cancelled by operator';
        task.locked_until = null;
      }
      if (upper.includes("SET STATUS = 'PENDING'")) {
        task.status = 'pending';
        task.next_run_at = params[0] || new Date();
        if (params.length > 2) task.last_error = params[1];
        task.locked_until = null;
        if (upper.includes('ATTEMPTS = 0')) {
          task.attempts = 0;
        }
      }
      if (upper.includes('SET ATTEMPTS =')) {
        const match = text.match(/SET\s+attempts\s*=\s*(\d+|\$\d+)/i);
        if (match) {
          if (match[1].startsWith('$')) {
            const pIdx = parseInt(match[1].slice(1), 10) - 1;
            task.attempts = Number(params[pIdx]);
          } else {
            task.attempts = parseInt(match[1], 10);
          }
        } else {
          task.attempts = Number(params[0]);
        }
      }
      if (upper.includes('SET NEXT_RUN_AT =')) {
        task.next_run_at = new Date(Date.now() - 1000);
        task.status = 'pending';
        task.locked_until = null;
      }
      if (upper.includes('SET LOCKED_UNTIL =') && !upper.includes("SET STATUS = '") && !text.includes('interval')) {
        task.locked_until = params[0];
      }

      return { rows: [{ ...task }], rowCount: 1 };
    }

    if (upper.includes('FROM NEEM_AUTOMATION_OUTBOX')) {
      const now = new Date();
      // Check if filtering by ID
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const task = this.tables.neem_automation_outbox.find(t => t.id === id);
        return { rows: task ? [{ ...task }] : [] };
      }
      // The bridge ingress checks idempotency before enqueueing. Keep the
      // ephemeral adapter faithful to PostgreSQL's unique-key lookup instead
      // of falling through to the unfiltered full-list response.
      if (upper.includes('WHERE') && upper.includes('IDEMPOTENCY_KEY =')) {
        const key = params[0];
        const task = this.tables.neem_automation_outbox.find(t => t.idempotency_key === key);
        return { rows: task ? [{ ...task }] : [] };
      }
      // Check if general query with optional filters
      if (upper.includes('WHERE') && (upper.includes('TENANT_ID') || upper.includes('STATUS'))) {
        let rows = [...this.tables.neem_automation_outbox];
        if (upper.includes('TENANT_ID =')) {
          rows = rows.filter(t => t.tenant_id === params[0]);
        }
        if (upper.includes('STATUS =')) {
          const sParam = params.find(p => ['pending', 'processing', 'acknowledged', 'dead_letter', 'cancelled'].includes(p));
          if (sParam) rows = rows.filter(t => t.status === sParam);
        }
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return { rows: rows.map(r => ({ ...r })) };
      }
      // Outbox claiming query without explicit UPDATE
      if (upper.includes("STATUS = 'PENDING'") && upper.includes('NEXT_RUN_AT <=')) {
        let rows = this.tables.neem_automation_outbox.filter(t => 
          (t.status === 'pending' || (t.status === 'processing' && t.locked_until && new Date(t.locked_until) < now)) &&
          (!t.next_run_at || new Date(t.next_run_at) <= now)
        );
        return { rows: rows.map(r => ({ ...r })) };
      }
      // Full list query for UI
      return { rows: [...this.tables.neem_automation_outbox].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(r => ({ ...r })) };
    }

    // --- Automation Cell States (Phase 6) ---
    if (upper.startsWith('INSERT INTO NEEM_AUTOMATION_CELL_STATES')) {
      const state = {
        id: params[0],
        tenant_id: params[1],
        cell_id: params[2],
        desired_version: params[3],
        applied_version: null,
        ack_version: null,
        ack_hash: null,
        last_synced_at: null,
        updated_at: new Date()
      };
      const existingIdx = this.tables.neem_automation_cell_states.findIndex(s => s.tenant_id === state.tenant_id && s.cell_id === state.cell_id);
      if (existingIdx >= 0) {
        this.tables.neem_automation_cell_states[existingIdx].desired_version = state.desired_version;
        this.tables.neem_automation_cell_states[existingIdx].updated_at = new Date();
        return { rows: [this.tables.neem_automation_cell_states[existingIdx]] };
      } else {
        this.tables.neem_automation_cell_states.push(state);
        return { rows: [state] };
      }
    }

    if (upper.startsWith('UPDATE NEEM_AUTOMATION_CELL_STATES')) {
      if (upper.includes('APPLIED_VERSION =')) {
        const version = params[0];
        const tenantId = params[1];
        const cellId = params[2];
        const state = this.tables.neem_automation_cell_states.find(s => s.tenant_id === tenantId && s.cell_id === cellId);
        if (state) {
          state.applied_version = version;
          state.updated_at = new Date();
        }
        return { rows: state ? [state] : [] };
      }
      if (upper.includes('ACK_VERSION =')) {
        const version = params[0];
        const ackHash = params[1];
        const tenantId = params[2];
        const cellId = params[3];
        const state = this.tables.neem_automation_cell_states.find(s => s.tenant_id === tenantId && s.cell_id === cellId);
        if (state) {
          state.ack_version = version;
          state.ack_hash = ackHash;
          state.last_synced_at = new Date();
          state.updated_at = new Date();
        }
        return { rows: state ? [state] : [] };
      }
    }

    if (upper.includes('FROM NEEM_AUTOMATION_CELL_STATES')) {
      if (upper.includes('WHERE TENANT_ID =')) {
        const rows = this.tables.neem_automation_cell_states.filter(s => s.tenant_id === params[0]);
        return { rows };
      }
      return { rows: [...this.tables.neem_automation_cell_states] };
    }

    // --- Cell Inbox Deduplication & ACK (P0 Hardening) ---
    if (upper.startsWith('INSERT INTO NEEM_CELL_INBOX')) {
      let id, tenantId, cellId, sourceOutboxId, idempotencyKey, taskType, payload, payloadDigest, status, lockedUntil, ackToken, receivedAt;
      
      if (params.length >= 8) {
        id = params[0];
        tenantId = params[1];
        cellId = params[2];
        sourceOutboxId = params[3];
        idempotencyKey = params[4];
        taskType = params[5];
        payload = safeJson(params[6], params[6]);
        payloadDigest = params[7];
        status = 'in_progress';
        lockedUntil = null;
        ackToken = null;
        if (params.length > 8) {
          if (typeof params[8] === 'string' && (params[8] === 'in_progress' || params[8] === 'completed')) {
            status = params[8];
            lockedUntil = params[9] || null;
            ackToken = params[10] || null;
          } else {
            lockedUntil = params[8];
            ackToken = params[9] || null;
          }
        }
        receivedAt = new Date();
      } else {
        id = params[0];
        tenantId = params[1];
        cellId = params[2];
        sourceOutboxId = params[3];
        idempotencyKey = params[4];
        taskType = params[5];
        payload = safeJson(params[6], params[6]);
        payloadDigest = null;
        status = 'completed';
        lockedUntil = null;
        ackToken = null;
        receivedAt = new Date();
      }

      const existing = this.tables.neem_cell_inbox.find(i => i.idempotency_key === idempotencyKey);
      if (existing) {
        if (upper.includes('ON CONFLICT DO NOTHING') || upper.includes('ON CONFLICT (IDEMPOTENCY_KEY) DO NOTHING')) {
          return { rows: [], rowCount: 0 };
        }
        if (upper.includes('ON CONFLICT')) {
          return { rows: [existing], rowCount: 0 };
        }
        const err = new Error(`duplicate key value violates unique constraint "neem_cell_inbox_idempotency_key_key"`);
        err.code = '23505';
        throw err;
      }

      const record = {
        id,
        tenant_id: tenantId,
        cell_id: cellId,
        source_outbox_id: sourceOutboxId,
        idempotency_key: idempotencyKey,
        task_type: taskType,
        payload,
        payload_digest: payloadDigest,
        status,
        locked_until: lockedUntil,
        ack_token: ackToken,
        received_at: receivedAt,
        processed_at: status === 'completed' ? new Date() : null,
        response_payload: null
      };
      this.tables.neem_cell_inbox.push(record);
      return { rows: [{ ...record }], rowCount: 1 };
    }

    if (upper.includes('FROM NEEM_CELL_INBOX')) {
      if (upper.includes('WHERE IDEMPOTENCY_KEY =')) {
        const item = this.tables.neem_cell_inbox.find(i => i.idempotency_key === params[0]);
        return { rows: item ? [{ ...item }] : [] };
      }
      if (upper.includes('WHERE ID =')) {
        const item = this.tables.neem_cell_inbox.find(i => i.id === params[0]);
        return { rows: item ? [{ ...item }] : [] };
      }
      if (upper.includes('WHERE CELL_ID =')) {
        const rows = this.tables.neem_cell_inbox.filter(i => i.cell_id === params[0]);
        return { rows: rows.map(r => ({ ...r })) };
      }
      return { rows: this.tables.neem_cell_inbox.map(r => ({ ...r })) };
    }

    if (upper.startsWith('UPDATE NEEM_CELL_INBOX')) {
      const whereIdx = upper.indexOf('WHERE');
      let targetKey = null;
      if (whereIdx !== -1) {
        const whereClause = text.slice(whereIdx);
        const match = whereClause.match(/(?:idempotency_key|id)\s*=\s*\$(\d+)/i);
        if (match) {
          targetKey = params[parseInt(match[1], 10) - 1];
        }
      }
      if (!targetKey) {
        targetKey = params[params.length - 1];
      }

      const item = this.tables.neem_cell_inbox.find(i => i.id === targetKey || i.idempotency_key === targetKey);
      if (!item) {
        return { rows: [], rowCount: 0 };
      }

      if (upper.includes("STATUS = 'COMPLETED'") || upper.includes('STATUS = $')) {
        item.status = 'completed';
        item.processed_at = new Date();
        item.locked_until = null;
        if (params.length >= 2) {
          item.ack_token = params[0];
          try {
            item.response_payload = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
          } catch {
            item.response_payload = params[1];
          }
        }
        return { rows: [{ ...item }], rowCount: 1 };
      }

      if (upper.includes('LOCKED_UNTIL = $')) {
        if (upper.includes('LOCKED_UNTIL IS NULL') || upper.includes('LOCKED_UNTIL <')) {
          if (item.locked_until && new Date(item.locked_until) > new Date()) {
            return { rows: [], rowCount: 0 };
          }
        }
        item.locked_until = params[0];
        if (upper.includes('ATTEMPTS =')) {
          item.attempts = (item.attempts || 0) + 1;
        }
        return { rows: [{ ...item }], rowCount: 1 };
      }

      let responsePayload = null;
      if (params.length === 2) {
        try {
          responsePayload = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
        } catch {
          responsePayload = params[0];
        }
      } else if (params.length > 2) {
        try {
          responsePayload = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        } catch {
          responsePayload = params[1];
        }
      }
      item.processed_at = new Date();
      item.response_payload = responsePayload;
      item.status = 'completed';
      return { rows: [{ ...item }], rowCount: 1 };
    }

    // --- Test Counters (P0 Hardening Database Counter Verification) ---
    if (upper.includes('NEEM_TEST_COUNTERS')) {
      if (!this.tables.neem_test_counters) this.tables.neem_test_counters = [];
      if (upper.startsWith('CREATE TABLE')) {
        return { rows: [], rowCount: 0 };
      }
      if (upper.startsWith('INSERT INTO NEEM_TEST_COUNTERS')) {
        const name = params[0];
        const val = Number(params[1] !== undefined ? params[1] : 0);
        let existing = this.tables.neem_test_counters.find(c => c.name === name);
        if (existing) {
          if (upper.includes('DO UPDATE')) {
            existing.val += val;
            return { rows: [{ ...existing }], rowCount: 1 };
          }
          return { rows: [{ ...existing }], rowCount: 0 };
        }
        const record = { name, val };
        this.tables.neem_test_counters.push(record);
        return { rows: [{ ...record }], rowCount: 1 };
      }
      if (upper.startsWith('UPDATE NEEM_TEST_COUNTERS')) {
        let name = params[params.length - 1];
        let delta = 1;
        if (params.length >= 2) {
          delta = Number(params[0]) || 1;
        }
        let existing = this.tables.neem_test_counters.find(c => c.name === name);
        if (!existing) {
          existing = { name, val: delta };
          this.tables.neem_test_counters.push(existing);
        } else {
          existing.val += delta;
        }
        return { rows: [{ ...existing }], rowCount: 1 };
      }
      if (upper.startsWith('SELECT') && upper.includes('FROM NEEM_TEST_COUNTERS')) {
        const name = params[0];
        const found = this.tables.neem_test_counters.find(c => c.name === name);
        return { rows: found ? [{ ...found }] : [{ name, val: 0 }] };
      }
    }

    // --- Support Tickets (Phase 7) ---
    // --- Support Tickets & Messages (Phase 7) ---
    if (upper.startsWith('INSERT INTO NEEM_SUPPORT_TICKETS')) {
      const ticket = {
        id: params[0],
        tenant_id: params[1],
        title: params[2],
        subject: params[2],
        description: params[3],
        severity: params[4] || 'normal',
        priority: params[4] || 'normal',
        creator_email: params[5],
        requester_id: params[5],
        status: params[6] || 'new',
        sla_due_at: params[7] || new Date(Date.now() + 24 * 3600 * 1000),
        assigned_to: params[8] || null,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_support_tickets.push(ticket);
      return { rows: [ticket] };
    }

    if (upper.includes('FROM NEEM_SUPPORT_TICKETS')) {
      if (upper.includes('WHERE ID =')) {
        const ticket = this.tables.neem_support_tickets.find(t => t.id === params[0]);
        return { rows: ticket ? [ticket] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const rows = this.tables.neem_support_tickets.filter(t => t.tenant_id === params[0]);
        return { rows };
      }
      return { rows: [...this.tables.neem_support_tickets] };
    }

    if (upper.startsWith('UPDATE NEEM_SUPPORT_TICKETS')) {
      // SET status = $1, assigned_to = $2, priority = $3, updated_at = now() WHERE id = $4
      if (upper.includes('WHERE ID =')) {
        const id = params[params.length - 1];
        const ticket = this.tables.neem_support_tickets.find(t => t.id === id);
        if (ticket) {
          if (params[0] !== undefined) ticket.status = params[0];
          if (params[1] !== undefined) ticket.assigned_to = params[1];
          if (params[2] !== undefined) {
            ticket.priority = params[2];
            ticket.severity = params[2];
          }
          ticket.updated_at = new Date();
          return { rows: [ticket] };
        }
      }
      return { rows: [] };
    }

    // --- Support Ticket Conversation Messages (Phase 7) ---
    if (upper.startsWith('INSERT INTO NEEM_SUPPORT_TICKET_MESSAGES')) {
      const msg = {
        id: params[0],
        ticket_id: params[1],
        sender_id: params[2],
        sender_type: params[3] || 'platform_support',
        is_internal: Boolean(params[4]),
        message_body: params[5],
        attachments: safeJson(params[6], []),
        created_at: new Date()
      };
      this.tables.neem_support_ticket_messages.push(msg);
      return { rows: [msg] };
    }

    if (upper.includes('FROM NEEM_SUPPORT_TICKET_MESSAGES')) {
      if (upper.includes('WHERE TICKET_ID =')) {
        let rows = this.tables.neem_support_ticket_messages.filter(m => m.ticket_id === params[0]);
        if (upper.includes('IS_INTERNAL = FALSE')) {
          rows = rows.filter(m => !m.is_internal);
        }
        return { rows: rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) };
      }
      return { rows: [...this.tables.neem_support_ticket_messages] };
    }

    // --- Support Sessions & View-As-User (Phase 7) ---
    if (upper.startsWith('INSERT INTO NEEM_SUPPORT_SESSIONS')) {
      const session = {
        id: params[0],
        ticket_id: params[1],
        tenant_id: params[2],
        support_principal_id: params[3],
        actor_id: params[3],
        view_as_user_id: params[4],
        session_scope: params[5],
        reason: params[6],
        token_hash: params[7],
        expires_at: params[8],
        is_write_allowed: Boolean(params[9]),
        write_justification: params[10] || null,
        scoped_actions: safeJson(params[11], []),
        audit_id: params[12] || null,
        approval_required: params[13] === undefined ? true : Boolean(params[13]),
        approval_status: params[14] || 'pending',
        tenant_approval_id: params[15] || null,
        approved_at: null,
        approval_rejected_at: null,
        revoked_at: null,
        created_at: new Date()
      };
      this.tables.neem_support_sessions.push(session);
      return { rows: [session] };
    }

    if (upper.startsWith('INSERT INTO NEEM_SUPPORT_SESSION_APPROVALS')) {
      const approval = {
        id: params[0],
        session_id: params[1],
        tenant_id: params[2],
        ticket_id: params[3] || null,
        token_hash: params[4],
        status: params[5] || 'pending',
        approver_identity_id: params[6] || null,
        approver_email: params[7] || null,
        response_reason: params[8] || null,
        requested_at: new Date(),
        expires_at: params[9],
        responded_at: params[10] || null
      };
      this.tables.neem_support_session_approvals.push(approval);
      return { rows: [approval] };
    }

    if (upper.includes('FROM NEEM_SUPPORT_SESSION_APPROVALS')) {
      if (upper.includes('WHERE TOKEN_HASH =')) {
        const approval = this.tables.neem_support_session_approvals.find((item) => item.token_hash === params[0]);
        return { rows: approval ? [{ ...approval }] : [] };
      }
      if (upper.includes('WHERE ID =')) {
        const approval = this.tables.neem_support_session_approvals.find((item) => item.id === params[0]);
        return { rows: approval ? [{ ...approval }] : [] };
      }
      if (upper.includes('WHERE SESSION_ID =')) {
        const approval = this.tables.neem_support_session_approvals.find((item) => item.session_id === params[0]);
        return { rows: approval ? [{ ...approval }] : [] };
      }
      return { rows: this.tables.neem_support_session_approvals.map((item) => ({ ...item })) };
    }

    if (upper.startsWith('UPDATE NEEM_SUPPORT_SESSION_APPROVALS')) {
      const id = params[params.length - 1];
      const approval = this.tables.neem_support_session_approvals.find((item) => item.id === id && item.status === 'pending');
      if (!approval) return { rows: [] };
      approval.status = params[0];
      approval.approver_identity_id = params[1] || null;
      approval.approver_email = params[2] || null;
      approval.response_reason = params[3] || null;
      approval.responded_at = params[4] || new Date();
      return { rows: [{ ...approval }] };
    }

    if (upper.includes('FROM NEEM_SUPPORT_SESSIONS')) {
      if (upper.includes('WHERE TOKEN_HASH =')) {
        const hash = params[0];
        const s = this.tables.neem_support_sessions.find(x => x.token_hash === hash);
        return { rows: s ? [s] : [] };
      }
      if (upper.includes('WHERE ID =')) {
        const s = this.tables.neem_support_sessions.find(x => x.id === params[0]);
        return { rows: s ? [s] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const rows = this.tables.neem_support_sessions.filter(x => x.tenant_id === params[0]);
        return { rows };
      }
      return { rows: [...this.tables.neem_support_sessions] };
    }

    if (upper.startsWith('UPDATE NEEM_SUPPORT_SESSIONS')) {
      const now = new Date();
      let affected = [];
      if (upper.includes('APPROVAL_STATUS')) {
        const status = params[0];
        const id = params[1];
        const s = this.tables.neem_support_sessions.find((item) => item.id === id);
        if (s) {
          s.approval_status = status;
          if (status === 'approved') s.approved_at = params[2] || now;
          if (status === 'rejected' || status === 'expired') s.approval_rejected_at = params[2] || now;
          affected.push(s);
        }
        return { rows: affected };
      }
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const s = this.tables.neem_support_sessions.find(x => x.id === id);
        if (s && !s.revoked_at) {
          s.revoked_at = now;
          affected.push(s);
        }
      } else {
        for (const s of this.tables.neem_support_sessions) {
          if (!s.revoked_at) {
            if (params.length > 0 && params[0]) {
              if (s.tenant_id === params[0]) {
                s.revoked_at = now;
                affected.push(s);
              }
            } else {
              s.revoked_at = now;
              affected.push(s);
            }
          }
        }
      }
      return { rows: affected };
    }

    // --- Isolated Tenant Customers Table with Encrypted PII (GM-17) ---
    if (upper.startsWith('INSERT INTO NEEM_TENANT_CUSTOMERS')) {
      const cust = {
        id: params[0],
        tenant_id: params[1],
        full_name: params[2],
        phone_encrypted: params[3],
        phone_hash: params[4],
        phone_last4: params[5],
        national_id_encrypted: params[6] || null,
        loyalty_tier: params[7] || 'standard',
        orders_count: params[8] || 0,
        total_spend: params[9] || 0,
        last_interaction_at: new Date(),
        created_at: new Date()
      };
      this.tables.neem_tenant_customers.push(cust);
      return { rows: [cust] };
    }

    if (upper.includes('FROM NEEM_TENANT_CUSTOMERS')) {
      let rows = [...this.tables.neem_tenant_customers];
      if (upper.includes('WHERE TENANT_ID =')) {
        rows = rows.filter(c => c.tenant_id === params[0]);
        if (upper.includes('PHONE_HASH =') && params[1]) {
          rows = rows.filter(c => c.phone_hash === params[1]);
        } else if (upper.includes('PHONE_LAST4 =') && params[1]) {
          rows = rows.filter(c => c.phone_last4 === params[1]);
        }
      } else if (upper.includes('WHERE ID =')) {
        rows = rows.filter(c => c.id === params[0]);
      }
      return { rows };
    }

    if (upper.startsWith('UPDATE NEEM_TENANT_CUSTOMERS')) {
      const newPhoneEnc = params[0];
      const id = params[1];
      const cust = this.tables.neem_tenant_customers.find(c => c.id === id);
      if (cust) {
        cust.phone_encrypted = newPhoneEnc;
        return { rows: [cust] };
      }
      return { rows: [] };
    }

    // --- Dedicated PII Access & Reveal Audit (GM-26) ---
    if (upper.startsWith('INSERT INTO NEEM_PII_ACCESS_AUDIT')) {
      const audit = {
        id: params[0],
        actor_id: params[1],
        support_actor_id: params[2] || null,
        tenant_id: params[3],
        session_id: params[4] || null,
        target_resource: params[5],
        action: params[6],
        reason: params[7],
        masked_before: params[8] || null,
        masked_after: params[9] || null,
        watermark_id: params[10] || null,
        created_at: new Date()
      };
      this.tables.neem_pii_access_audit.push(audit);
      return { rows: [audit] };
    }

    if (upper.includes('FROM NEEM_PII_ACCESS_AUDIT')) {
      let rows = [...this.tables.neem_pii_access_audit];
      if (upper.includes('WHERE TENANT_ID =')) {
        rows = rows.filter(a => a.tenant_id === params[0]);
      }
      return { rows: rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
    }

    // --- Keyring Re-encryption Jobs ---
    if (upper.startsWith('INSERT INTO NEEM_KEYRING_REENCRYPT_JOBS')) {
      const job = {
        id: params[0],
        current_key_version: params[1],
        target_key_version: params[2],
        total_records: params[3] || 0,
        reencrypted_records: params[4] || 0,
        failed_records: params[5] || 0,
        cursor_id: params[6] || null,
        status: params[7] || 'in_progress',
        error_summary: params[8] || null,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_keyring_reencrypt_jobs.push(job);
      return { rows: [job] };
    }

    if (upper.includes('FROM NEEM_KEYRING_REENCRYPT_JOBS')) {
      if (upper.includes('WHERE ID =')) {
        const j = this.tables.neem_keyring_reencrypt_jobs.find(x => x.id === params[0]);
        return { rows: j ? [j] : [] };
      }
      return { rows: [...this.tables.neem_keyring_reencrypt_jobs] };
    }

    if (upper.startsWith('UPDATE NEEM_KEYRING_REENCRYPT_JOBS')) {
      const id = params[params.length - 1];
      const job = this.tables.neem_keyring_reencrypt_jobs.find(x => x.id === id);
      if (job) {
        if (params[0] !== undefined) job.reencrypted_records = params[0];
        if (params[1] !== undefined) job.failed_records = params[1];
        if (params[2] !== undefined) job.cursor_id = params[2];
        if (params[3] !== undefined) job.status = params[3];
        job.updated_at = new Date();
        return { rows: [job] };
      }
      return { rows: [] };
    }

    // --- Infrastructure Domains (Phase 8) ---
    if (upper.startsWith('INSERT INTO NEEM_INFRASTRUCTURE_DOMAINS')) {
      const dom = {
        id: params[0],
        tenant_id: params[1],
        domain_name: params[2],
        domain_kind: params[3] || 'custom_domain',
        expected_cname: params[4],
        brand_config: typeof params[5] === 'string' ? JSON.parse(params[5]) : (params[5] || {}),
        dns_verification_status: params[6] || 'pending',
        tls_status: params[7] || 'pending',
        current_cname: null,
        tls_error_reason: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_infrastructure_domains.push(dom);
      return { rows: [dom] };
    }

    if (upper.startsWith('UPDATE NEEM_INFRASTRUCTURE_DOMAINS')) {
      const id = params[params.length - 1];
      const dom = this.tables.neem_infrastructure_domains.find(d => d.id === id);
      if (dom) {
        if (upper.includes('DNS_VERIFICATION_STATUS =')) {
          dom.dns_verification_status = params[0];
          dom.current_cname = params[1];
          dom.updated_at = new Date();
        }
        if (upper.includes("TLS_STATUS = 'FAILED'")) {
          dom.tls_status = 'failed';
          dom.tls_error_reason = params[0];
          dom.updated_at = new Date();
        }
        if (upper.includes("TLS_STATUS = 'ISSUED'")) {
          dom.tls_status = 'issued';
          dom.tls_error_reason = null;
          dom.updated_at = new Date();
        }
      }
      return { rows: dom ? [dom] : [] };
    }

    if (upper.includes('FROM NEEM_INFRASTRUCTURE_DOMAINS')) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const dom = this.tables.neem_infrastructure_domains.find(d => d.id === id);
        return { rows: dom ? [dom] : [] };
      }
      if (upper.includes('WHERE DOMAIN_NAME =')) {
        const name = (params[0] || '').toLowerCase();
        const dom = this.tables.neem_infrastructure_domains.find(d => d.domain_name.toLowerCase() === name);
        return { rows: dom ? [dom] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const tId = params[0];
        const rows = this.tables.neem_infrastructure_domains.filter(d => d.tenant_id === tId);
        return { rows };
      }
      return { rows: [...this.tables.neem_infrastructure_domains] };
    }

    // --- Infrastructure Certificates (Phase 8) ---
    if (upper.startsWith('INSERT INTO NEEM_INFRASTRUCTURE_CERTIFICATES')) {
      const cert = {
        id: params[0],
        domain_id: params[1],
        provider: params[2],
        certificate_serial: params[3],
        valid_from: params[4],
        valid_until: params[5],
        status: params[6] || 'active',
        created_at: new Date()
      };
      this.tables.neem_infrastructure_certificates.push(cert);
      return { rows: [cert] };
    }

    // --- Edge Devices (Phase 9) ---
    if (upper.startsWith('INSERT INTO NEEM_EDGE_DEVICES')) {
      const dev = {
        id: params[0],
        tenant_id: params[1],
        branch_id: params[2],
        device_name: params[3],
        device_kind: params[4] || 'pos_station',
        pairing_code: params[5],
        device_secret_hash: params[6],
        status: 'paired',
        fencing_epoch: 1,
        last_seen_at: new Date(),
        created_at: new Date()
      };
      this.tables.neem_edge_devices.push(dev);
      return { rows: [dev] };
    }

    if (upper.startsWith('UPDATE NEEM_EDGE_DEVICES')) {
      const id = params[0];
      const tenantId = params[1];
      const dev = this.tables.neem_edge_devices.find(d => d.id === id && d.tenant_id === tenantId);
      if (dev) {
        if (upper.includes("SET STATUS = 'FENCED'")) {
          dev.status = 'fenced';
          dev.fencing_epoch = (dev.fencing_epoch || 1) + 1;
        }
      }
      return { rows: dev ? [dev] : [] };
    }

    if (upper.includes('FROM NEEM_EDGE_DEVICES')) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const dev = this.tables.neem_edge_devices.find(d => d.id === id);
        return { rows: dev ? [dev] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const tenantId = params[0];
        return { rows: this.tables.neem_edge_devices.filter((device) => device.tenant_id === tenantId) };
      }
      return { rows: [...this.tables.neem_edge_devices] };
    }

    // --- Edge Leases (Phase 9) ---
    if (upper.startsWith('INSERT INTO NEEM_EDGE_LEASES')) {
      const lease = {
        id: params[0],
        device_id: params[1],
        tenant_id: params[2],
        lease_token_hash: params[3],
        lease_epoch: params[4] || 1,
        expires_at: params[5],
        revoked_at: null,
        created_at: new Date()
      };
      this.tables.neem_edge_leases.push(lease);
      return { rows: [lease] };
    }

    if (upper.includes('FROM NEEM_EDGE_LEASES')) {
      if (upper.includes('JOIN NEEM_EDGE_DEVICES')) {
        const tokenHash = params[0];
        const lease = this.tables.neem_edge_leases.find(l => l.lease_token_hash === tokenHash);
        if (!lease) return { rows: [] };
        const dev = this.tables.neem_edge_devices.find(d => d.id === lease.device_id) || {};
        return {
          rows: [{
            ...lease,
            device_status: dev.status || 'paired',
            device_fencing_epoch: dev.fencing_epoch || 1
          }]
        };
      }
      if (upper.includes('WHERE LEASE_TOKEN_HASH =')) {
        const tokenHash = params[0];
        const lease = this.tables.neem_edge_leases.find(l => l.lease_token_hash === tokenHash);
        return { rows: lease ? [lease] : [] };
      }
      return { rows: [...this.tables.neem_edge_leases] };
    }

    // --- Durable Edge Order Receipts (Phase 9) ---
    if (upper.startsWith('INSERT INTO NEEM_EDGE_ORDER_RECEIPTS')) {
      const tenantId = params[0];
      const orderId = params[1];
      const existing = this.tables.neem_edge_order_receipts.find((receipt) => (
        receipt.tenant_id === tenantId && receipt.order_id === orderId
      ));
      if (existing) return { rows: [], rowCount: 0 };
      const receipt = {
        tenant_id: tenantId,
        order_id: orderId,
        device_id: params[2],
        receipt_number: params[3] || null,
        payload_hash: params[4],
        order_payload: typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5],
        accepted_at: new Date()
      };
      this.tables.neem_edge_order_receipts.push(receipt);
      return {
        rows: [{
          tenant_id: receipt.tenant_id,
          order_id: receipt.order_id,
          payload_hash: receipt.payload_hash
        }],
        rowCount: 1
      };
    }

    if (upper.includes('FROM NEEM_EDGE_ORDER_RECEIPTS')) {
      let rows = [...this.tables.neem_edge_order_receipts];
      if (upper.includes('WHERE TENANT_ID =') && upper.includes('AND ORDER_ID =')) {
        rows = rows.filter((receipt) => receipt.tenant_id === params[0] && receipt.order_id === params[1]);
      } else if (upper.includes('WHERE TENANT_ID =')) {
        rows = rows.filter((receipt) => receipt.tenant_id === params[0]);
      }
      return { rows };
    }

    // --- Edge Sync Conflicts (Phase 9) ---
    if (upper.startsWith('INSERT INTO NEEM_EDGE_SYNC_CONFLICTS')) {
      const conf = {
        id: params[0],
        tenant_id: params[1],
        device_id: params[2],
        entity_kind: params[3],
        entity_id: params[4],
        conflict_policy: params[5],
        cloud_state: typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6],
        edge_state: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
        resolution_status: params[8] || 'open',
        created_at: new Date()
      };
      this.tables.neem_edge_sync_conflicts.push(conf);
      return { rows: [conf] };
    }

    if (upper.includes('FROM NEEM_EDGE_SYNC_CONFLICTS')) {
      if (upper.includes('WHERE TENANT_ID =')) {
        const rows = this.tables.neem_edge_sync_conflicts.filter(c => c.tenant_id === params[0]);
        return { rows };
      }
      return { rows: [...this.tables.neem_edge_sync_conflicts] };
    }

    // --- Edge Packages (Phase 9) ---
    if (upper.startsWith('INSERT INTO NEEM_EDGE_PACKAGES')) {
      const pkg = {
        version: params[0],
        package_url: params[1],
        checksum_sha256: params[2],
        signature_hex: params[3],
        release_notes: params[4],
        created_at: new Date()
      };
      this.tables.neem_edge_packages.push(pkg);
      return { rows: [pkg] };
    }

    if (upper.includes('FROM NEEM_EDGE_PACKAGES')) {
      return { rows: [...this.tables.neem_edge_packages] };
    }

    // --- Backup Manifests (Phase 10) ---
    if (upper.startsWith('INSERT INTO NEEM_BACKUP_MANIFESTS')) {
      const manifest = {
        id: params[0],
        tenant_id: params[1],
        scope: params[2] || 'tenant',
        epoch: params[3] || 1,
        db_dump_ref: params[4],
        db_checksum_sha256: params[5],
        files_ref: params[6],
        files_checksum_sha256: params[7],
        config_snapshot: typeof params[8] === 'string' ? JSON.parse(params[8]) : params[8],
        encryption_key_id: params[9],
        status: params[10] || 'pending',
        retention_tier: params[11] || 'daily',
        size_bytes: params[12] || 0,
        created_at: params[13] || new Date(),
        expires_at: params[14]
      };
      this.tables.neem_backup_manifests.push(manifest);
      return { rows: [manifest] };
    }

    if (upper.startsWith('UPDATE NEEM_BACKUP_MANIFESTS')) {
      const id = params[params.length - 1];
      const m = this.tables.neem_backup_manifests.find(x => x.id === id);
      if (m) {
        if (upper.includes('SET ENCRYPTION_KEY_ID')) {
          m.encryption_key_id = params[0];
        }
        if (upper.includes("SET STATUS = 'VERIFIED'")) {
          m.status = 'verified';
        }
        if (upper.includes("SET STATUS = 'CORRUPT'")) {
          m.status = 'corrupt';
        }
      }
      return { rows: m ? [m] : [] };
    }

    if (upper.includes('FROM NEEM_BACKUP_MANIFESTS')) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const m = this.tables.neem_backup_manifests.find(x => x.id === id);
        return { rows: m ? [m] : [] };
      }
      if (upper.includes('WHERE TENANT_ID =')) {
        const rows = this.tables.neem_backup_manifests.filter(x => x.tenant_id === params[0]);
        return { rows };
      }
      return { rows: [...this.tables.neem_backup_manifests] };
    }

    // --- Restore Drills (Phase 10) ---
    if (upper.startsWith('INSERT INTO NEEM_RESTORE_DRILLS')) {
      const drill = {
        id: params[0],
        manifest_id: params[1],
        target_tenant_id: params[2],
        target_isolation_db: params[3],
        pre_restore_epoch: params[4],
        post_restore_epoch: params[5],
        reconciliation_status: params[6] || 'verified_isolated',
        diff_summary: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
        rto_seconds: params[8] || 0,
        rpo_minutes: params[9] || 0,
        executed_by: params[10],
        created_at: new Date()
      };
      this.tables.neem_restore_drills.push(drill);
      return { rows: [drill] };
    }

    if (upper.includes('FROM NEEM_RESTORE_DRILLS')) {
      return { rows: [...this.tables.neem_restore_drills] };
    }

    // --- Releases (Phase 11) ---
    if (upper.startsWith('INSERT INTO NEEM_RELEASES')) {
      const rel = {
        version: params[0],
        manifest_checksum: params[1],
        git_commit_sha: params[2],
        min_compatible_edge_version: params[3],
        release_notes: params[4],
        status: 'draft',
        created_at: new Date()
      };
      this.tables.neem_releases.push(rel);
      return { rows: [rel] };
    }

    if (upper.startsWith('UPDATE NEEM_RELEASES')) {
      const ver = params[params.length - 1];
      const rel = this.tables.neem_releases.find(r => r.version === ver);
      if (rel) {
        if (upper.includes("SET STATUS = 'CANARY'")) rel.status = 'canary';
        if (upper.includes("SET STATUS = 'ROLLED_BACK'")) rel.status = 'rolled_back';
        if (upper.includes("SET STATUS = 'PROMOTED'")) rel.status = 'promoted';
      }
      return { rows: rel ? [rel] : [] };
    }

    if (upper.includes('FROM NEEM_RELEASES')) {
      let rows = [...this.tables.neem_releases];
      if (upper.includes('WHERE VERSION =')) {
        const ver = params[0];
        const rel = this.tables.neem_releases.find(r => r.version === ver);
        return { rows: rel ? [rel] : [] };
      }
      if (upper.includes("STATUS = 'PROMOTED'")) {
        rows = rows.filter(r => r.status === 'promoted');
      }
      if (upper.includes('VERSION <>')) {
        rows = rows.filter(r => r.version !== params[0]);
      }
      if (upper.includes('ORDER BY CREATED_AT DESC')) {
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      return { rows };
    }

    // --- Rollout Waves (Phase 11) ---
    if (upper.startsWith('INSERT INTO NEEM_ROLLOUT_WAVES')) {
      const wave = {
        id: params[0],
        version: params[1],
        wave_number: params[2],
        target_cohort: params[3],
        target_tenants: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
        healthy_threshold_pct: 95.0,
        error_budget_threshold_pct: 2.0,
        latency_p95_threshold_ms: Number(params[5]),
        status: 'running',
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_rollout_waves.push(wave);
      return { rows: [wave] };
    }

    if (upper.startsWith('UPDATE NEEM_ROLLOUT_WAVES')) {
      const id = params[params.length - 1];
      const wave = this.tables.neem_rollout_waves.find(w => w.id === id);
      if (wave) {
        if (upper.includes("SET STATUS = 'ABORTED'")) wave.status = 'aborted';
        if (upper.includes("SET STATUS = 'PASSED'")) wave.status = 'passed';
        wave.updated_at = new Date();
      }
      return { rows: wave ? [wave] : [] };
    }

    if (upper.includes('FROM NEEM_ROLLOUT_WAVES')) {
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        const wave = this.tables.neem_rollout_waves.find(w => w.id === id);
        return { rows: wave ? [wave] : [] };
      }
      let rows = [...this.tables.neem_rollout_waves];
      if (upper.includes('WHERE VERSION =') && upper.includes('WAVE_NUMBER =')) {
        rows = rows.filter((wave) => wave.version === params[0] && wave.wave_number === Number(params[1]));
      }
      return { rows };
    }

    // --- Incidents (Phase 11 & Phase 6 Operational Tracking) ---
    if (upper.startsWith('INSERT INTO NEEM_INCIDENTS')) {
      let inc;
      if (params.length >= 8) {
        inc = {
          id: params[0],
          title: params[1],
          severity: params[2] || 'sev3_minor',
          status: params[3] || 'investigating',
          affected_scope: params[4],
          trigger_event: params[5],
          root_cause: params[6],
          mitigation_actions: typeof params[7] === 'string' ? JSON.parse(params[7]) : (params[7] || []),
          created_at: new Date(),
          resolved_at: null
        };
      } else {
        inc = {
          id: params[0],
          title: params[1],
          severity: 'sev1_critical',
          status: 'mitigated',
          affected_scope: params[2],
          trigger_event: 'CANARY_CIRCUIT_BREAKER_TRIPPED',
          root_cause: params[3],
          mitigation_actions: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
          created_at: new Date(),
          resolved_at: null
        };
      }
      const existing = this.tables.neem_incidents.find((candidate) => candidate.id === inc.id);
      if (existing && upper.includes('ON CONFLICT')) {
        return { rows: [existing] };
      }
      this.tables.neem_incidents.push(inc);
      return { rows: [inc] };
    }

    if (upper.startsWith('UPDATE NEEM_INCIDENTS')) {
      const updated = [];
      for (const inc of this.tables.neem_incidents) {
        if (upper.includes("STATUS = 'RESOLVED'") || upper.includes('STATUS = $')) {
          if (params.length >= 2 && inc.affected_scope === params[0] && inc.trigger_event === params[1] && inc.status !== 'resolved') {
            inc.status = 'resolved';
            inc.resolved_at = new Date();
            updated.push(inc);
          } else if (params.length === 1 && inc.id === params[0]) {
            inc.status = 'resolved';
            inc.resolved_at = new Date();
            updated.push(inc);
          }
        } else if (upper.includes('ROOT_CAUSE =') || upper.includes('MITIGATION_ACTIONS =')) {
          const id = params[params.length - 1];
          if (inc.id === id) {
            inc.root_cause = params[0];
            inc.mitigation_actions = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
            if (params.length >= 4 && params[2]) {
              inc.severity = params[2];
            }
            inc.updated_at = new Date();
            updated.push(inc);
          }
        }
      }
      return { rows: updated };
    }

    if (upper.includes('FROM NEEM_INCIDENTS')) {
      let rows = [...this.tables.neem_incidents];
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        rows = rows.filter(i => i.id === id);
      } else {
        if (upper.includes('AFFECTED_SCOPE LIKE')) {
          const cleanPattern = (params[0] || '').replace(/%/g, '');
          rows = rows.filter(i => i.affected_scope && i.affected_scope.includes(cleanPattern));
        } else if (upper.includes('AFFECTED_SCOPE =')) {
          const scope = params[0];
          rows = rows.filter(i => i.affected_scope === scope);
        }
        if (upper.includes('TRIGGER_EVENT =')) {
          const trigger = params.find(p => typeof p === 'string' && (p === 'OUTBOX_DEAD_LETTER' || p === 'OUTBOX_RETRY_SCHEDULED' || p.startsWith('CANARY_')));
          if (trigger) {
            rows = rows.filter(i => i.trigger_event === trigger);
          }
        }
      }
      if (upper.includes("STATUS != 'RESOLVED'")) {
        rows = rows.filter(i => i.status !== 'resolved');
      }
      if (upper.includes('ORDER BY CREATED_AT DESC')) {
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      return { rows };
    }

    // --- Tenant Identities & Memberships (GM-13) ---
    if (upper.includes('FROM NEEM_TENANT_IDENTITIES') && !upper.includes('JOIN NEEM_TENANT_MEMBERSHIPS')) {
      let rows = [...this.tables.neem_tenant_identities];
      if (upper.includes('WHERE ID =')) {
        const id = params[0];
        rows = rows.filter(i => i.id === id);
      } else if (upper.includes('WHERE EMAIL =') || upper.includes('WHERE LOWER(EMAIL) =')) {
        const email = (params[0] || '').toLowerCase().trim();
        rows = rows.filter(i => (i.email || '').toLowerCase().trim() === email);
      }
      return { rows };
    }

    if (upper.startsWith('INSERT INTO NEEM_TENANT_IDENTITIES')) {
      const existing = this.tables.neem_tenant_identities.find(x => x.id === params[0] || (params[2] && x.email && x.email.toLowerCase() === params[2].toLowerCase()));
      if (existing) {
        return { rows: [existing] };
      }
      const item = {
        id: params[0],
        display_name: params[1],
        email: params[2],
        phone: params[3] || null,
        identity_type: params[4] || 'restaurant_staff',
        status: params[5] || 'active',
        mfa_enabled: Boolean(params[6]),
        metadata: typeof params[7] === 'string' ? JSON.parse(params[7]) : (params[7] || {}),
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_tenant_identities.push(item);
      return { rows: [item] };
    }

    if (upper.startsWith('UPDATE NEEM_TENANT_IDENTITIES')) {
      const id = params[params.length - 1];
      const item = this.tables.neem_tenant_identities.find(x => x.id === id);
      if (item) {
        if (upper.includes('STATUS =')) {
          item.status = params[0];
        }
        item.updated_at = new Date();
      }
      return { rows: item ? [item] : [] };
    }

    if (upper.includes('FROM NEEM_TENANT_MEMBERSHIPS')) {
      let rows = this.tables.neem_tenant_memberships.map(m => {
        const ident = this.tables.neem_tenant_identities.find(i => i.id === m.identity_id) || {};
        return {
          ...m,
          display_name: ident.display_name || '',
          email: ident.email || '',
          phone: ident.phone || null,
          identity_type: ident.identity_type || 'restaurant_staff',
          identity_status: ident.status || 'active',
          mfa_enabled: ident.mfa_enabled ?? false
        };
      });

      if (upper.includes('M.TENANT_ID = $1') || upper.includes('WHERE TENANT_ID = $1') || upper.includes('WHERE M.TENANT_ID =')) {
        const tId = params[0];
        rows = rows.filter(m => m.tenant_id === tId);
      }

      if (upper.includes('(M.ID = $2 OR M.IDENTITY_ID = $2)') || upper.includes('(ID = $2 OR IDENTITY_ID = $2)')) {
        const target = params[1];
        if (target) {
          rows = rows.filter(m => m.id === target || m.identity_id === target);
        }
      } else if (upper.includes('WHERE M.ID = $1') || (upper.includes('WHERE ID = $1') && !upper.includes('TENANT_ID'))) {
        const target = params[0];
        if (target) {
          rows = rows.filter(m => m.id === target || m.identity_id === target);
        }
      }

      if (upper.includes('STATUS =')) {
        const statusVal = params.find(p => ['active', 'suspended', 'revoked'].includes(p));
        if (statusVal) {
          rows = rows.filter(m => m.status === statusVal);
        }
      }
      if (upper.includes('ROLE =')) {
        const roleVal = params.find(p => ['owner', 'manager', 'accountant', 'cashier', 'kitchen', 'waiter', 'support'].includes(p));
        if (roleVal) {
          rows = rows.filter(m => m.role === roleVal);
        }
      }
      return { rows };
    }

    if (upper.startsWith('INSERT INTO NEEM_TENANT_MEMBERSHIPS')) {
      const tenantId = params[1];
      const identityId = params[2];
      const duplicate = this.tables.neem_tenant_memberships.find(m => m.tenant_id === tenantId && m.identity_id === identityId);
      if (duplicate) {
        const err = new Error('duplicate key value violates unique constraint "uq_tenant_identity"');
        err.code = '23505';
        throw err;
      }
      const mem = {
        id: params[0],
        tenant_id: tenantId,
        identity_id: identityId,
        role: params[3] || 'cashier',
        branch_scope: params[4] || '*',
        status: params[5] || 'active',
        active_sessions: Number(params[6]) || 1,
        invited_at: new Date(),
        accepted_at: new Date(),
        revoked_at: null,
        invited_by: params[7] || 'system',
        revoked_by: null,
        metadata: typeof params[8] === 'string' ? JSON.parse(params[8]) : (params[8] || {}),
        created_at: new Date(),
        updated_at: new Date()
      };
      this.tables.neem_tenant_memberships.push(mem);
      const ident = this.tables.neem_tenant_identities.find(i => i.id === identityId) || {};
      return {
        rows: [{
          ...mem,
          display_name: ident.display_name || '',
          email: ident.email || '',
          phone: ident.phone || null,
          identity_type: ident.identity_type || 'restaurant_staff',
          identity_status: ident.status || 'active',
          mfa_enabled: ident.mfa_enabled ?? false
        }]
      };
    }

    if (upper.startsWith('UPDATE NEEM_TENANT_MEMBERSHIPS')) {
      const idOrIdent = params[params.length - 1];
      const tenantId = params.length > 2 ? params[params.length - 2] : null;
      const mem = this.tables.neem_tenant_memberships.find(m => 
        (m.id === idOrIdent || m.identity_id === idOrIdent) && (!tenantId || m.tenant_id === tenantId)
      );
      if (mem) {
        if (upper.includes('ROLE = $1')) {
          mem.role = params[0];
          if (upper.includes('BRANCH_SCOPE = $2')) {
            mem.branch_scope = params[1];
          }
        }
        if (upper.includes("STATUS = 'REVOKED'")) {
          mem.status = 'revoked';
          mem.active_sessions = 0;
          mem.revoked_at = new Date();
          mem.revoked_by = params[0] || 'system';
        } else if (upper.includes('STATUS = $1')) {
          mem.status = params[0];
          if (mem.status === 'suspended' || mem.status === 'revoked') {
            mem.active_sessions = 0;
          }
        }
        mem.updated_at = new Date();
      }
      return { rows: mem ? [mem] : [] };
    }

    if (upper.startsWith('DELETE FROM NEEM_TENANT_MEMBERSHIPS')) {
      const id = params[0];
      const tId = params[1];
      const idx = this.tables.neem_tenant_memberships.findIndex(m => 
        (m.id === id || m.identity_id === id) && (!tId || m.tenant_id === tId)
      );
      if (idx !== -1) {
        const deleted = this.tables.neem_tenant_memberships.splice(idx, 1)[0];
        return { rows: [deleted] };
      }
      return { rows: [] };
    }

    return { rows: [] };
  }

  async getClient() {
    return new InMemoryClient(this);
  }

  async connect() {
    return this.getClient();
  }

  reset() {
    this.tables.neem_platform_principals = [];
    this.tables.neem_platform_mfa_factors = [];
    this.tables.neem_platform_recovery_codes = [];
    this.tables.neem_platform_sessions = [];
    this.tables.neem_control_audit_events = [];
    this.tables.neem_audit_export_cursors = [];
    this.tables.neem_commercial_grants = [];
    this.tables.neem_personal_overrides = [];
    this.tables.neem_published_policies = [];
    this.tables.neem_policy_outbox = [];
    this.tables.neem_provisioning_jobs = [];
    this.tables.neem_tenant_resources = [];
    this.tables.neem_tenant_invitations = [];
    this.tables.neem_tenant_backups = [];
    this.tables.neem_billing_plans = [
      {
        plan_code: 'starter',
        name_fa: 'پلن پایه (استارتر)',
        base_price_monthly_rials: 45000000,
        included_branches: 1,
        included_devices: 2,
        features: ['core.workspace', 'catalog.menu', 'orders.pos'],
        is_active: true,
        created_at: new Date('2024-01-01')
      },
      {
        plan_code: 'growth',
        name_fa: 'پلن رشد (گروت)',
        base_price_monthly_rials: 95000000,
        included_branches: 2,
        included_devices: 5,
        features: ['core.workspace', 'catalog.menu', 'orders.pos', 'floor.tables', 'kitchen.kds'],
        is_active: true,
        created_at: new Date('2024-01-01')
      },
      {
        plan_code: 'scale',
        name_fa: 'پلن مقیاس (اسکیل)',
        base_price_monthly_rials: 180000000,
        included_branches: 5,
        included_devices: 12,
        features: ['core.workspace', 'catalog.menu', 'orders.pos', 'floor.tables', 'kitchen.kds', 'finance.workspace', 'stock.inventory'],
        is_active: true,
        created_at: new Date('2024-01-01')
      },
      {
        plan_code: 'enterprise',
        name_fa: 'پلن سازمانی (اینترپرایز)',
        base_price_monthly_rials: 350000000,
        included_branches: 15,
        included_devices: 40,
        features: ['core.workspace', 'core.multi_branch', 'catalog.menu', 'orders.pos', 'floor.tables', 'kitchen.kds', 'finance.workspace', 'stock.inventory', 'crm.directory', 'insights.reports'],
        is_active: true,
        created_at: new Date('2024-01-01')
      }
    ];
    this.tables.neem_billing_subscriptions = [
      {
        id: 'sub_westo_001',
        tenant_id: 'westo-demo',
        plan_code: 'scale',
        status: 'active',
        billing_cycle: 'annual',
        current_period_start: new Date('2024-01-01'),
        current_period_end: new Date('2025-01-01'),
        cancel_at_period_end: false,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      },
      {
        id: 'sub_cafe_002',
        tenant_id: 'tehran-cafe-02',
        plan_code: 'starter',
        status: 'trial',
        billing_cycle: 'monthly',
        current_period_start: new Date('2024-06-01'),
        current_period_end: new Date('2024-06-15'),
        cancel_at_period_end: false,
        created_at: new Date('2024-06-01'),
        updated_at: new Date('2024-06-01')
      }
    ];
    this.tables.neem_billing_invoices = [
      {
        id: 'inv_westo_2026_01',
        invoice_number: 'INV-1404-0982',
        tenant_id: 'westo-demo',
        subscription_id: 'sub_westo_001',
        amount_subtotal_rials: 2160000000,
        vat_amount_rials: 172800000,
        discount_amount_rials: 432000000,
        amount_total_rials: 1900800000,
        status: 'paid',
        entitlement_status: 'activated',
        due_date: new Date('2024-01-05'),
        paid_at: new Date('2024-01-02'),
        settlement_reference: 'SEP-REF-14040102001',
        line_items: [
          {
            description: 'پلن مقیاس (اسکیل) سالانه',
            quantity: 12,
            unitPriceRials: 180000000,
            totalRials: 2160000000
          }
        ],
        created_at: new Date('2024-01-01')
      }
    ];
    this.tables.neem_billing_transactions = [
      {
        id: 'tx_westo_001',
        invoice_id: 'inv_westo_2026_01',
        tenant_id: 'westo-demo',
        idempotency_key: 'idemp_seed_westo_001',
        gateway_provider: 'saman_sep',
        gateway_authority: 'auth_seed_westo_111',
        trace_number: 'TRACE_9918231',
        amount_rials: 1900800000,
        status: 'successful',
        entitlement_activated: true,
        created_at: new Date('2024-01-02'),
        settled_at: new Date('2024-01-02')
      }
    ];
    this.tables.neem_billing_quotas = [];
    this.tables.neem_automation_rules = [];
    this.tables.neem_automation_rule_versions = [];
    this.tables.neem_automation_executions = [];
    this.tables.neem_automation_processed_keys = [];
    this.tables.neem_automation_outbox = [];
    this.tables.neem_cell_inbox = [];
    this.tables.neem_test_counters = [];
    this.tables.neem_automation_cell_states = [];
    this.tables.neem_support_tickets = [];
    this.tables.neem_support_ticket_messages = [];
    this.tables.neem_support_sessions = [];
    this.tables.neem_support_session_approvals = [];
    this.tables.neem_support_approval_rate_limits = [];
    this.tables.neem_pii_encryption_keys = [];
    this.tables.neem_tenant_customers = getSeedTenantCustomers();
    this.tables.neem_pii_access_audit = [];
    this.tables.neem_keyring_reencrypt_jobs = [];
    this.tables.neem_infrastructure_domains = [];
    this.tables.neem_infrastructure_certificates = [];
    this.tables.neem_infrastructure_probes = [];
    this.tables.neem_edge_devices = [];
    this.tables.neem_edge_leases = [];
    this.tables.neem_edge_sync_conflicts = [];
    this.tables.neem_edge_order_receipts = [];
    this.tables.neem_edge_packages = [];
    this.tables.neem_backup_manifests = [];
    this.tables.neem_restore_drills = [];
    this.tables.neem_backup_policies = [];
    this.tables.neem_releases = [];
    this.tables.neem_rollout_waves = [];
    this.tables.neem_incidents = [];
    this.tables.neem_platform_mfa_challenges = [];
    this.tables.neem_tenant_identities = [
      {
        id: 'usr_westo_owner',
        display_name: 'سهراب آریا (مالک وستو)',
        email: 'owner@westo.demo.neem.ir',
        phone: '+989121111111',
        identity_type: 'restaurant_staff',
        status: 'active',
        mfa_enabled: true,
        metadata: { title: 'مدیرعامل و مالک برند' },
        created_at: new Date('2024-06-01T00:00:00Z'),
        updated_at: new Date('2024-06-01T00:00:00Z')
      },
      {
        id: 'usr_westo_mgr',
        display_name: 'مریم فخیمی (مدیر داخلی)',
        email: 'manager@westo.demo.neem.ir',
        phone: '+989122222222',
        identity_type: 'restaurant_staff',
        status: 'active',
        mfa_enabled: true,
        metadata: { title: 'مدیر شعبه مرکزی' },
        created_at: new Date('2024-06-05T00:00:00Z'),
        updated_at: new Date('2024-06-05T00:00:00Z')
      },
      {
        id: 'usr_westo_cashier_01',
        display_name: 'علی کاظمی (صندوقدار)',
        email: 'cashier1@westo.demo.neem.ir',
        phone: '+989123333333',
        identity_type: 'restaurant_staff',
        status: 'active',
        mfa_enabled: false,
        metadata: { title: 'صندوقدار شیفت عصر' },
        created_at: new Date('2024-06-10T00:00:00Z'),
        updated_at: new Date('2024-06-10T00:00:00Z')
      },
      {
        id: 'usr_shiraz_owner',
        display_name: 'کوروش زند (مالک بیسترو)',
        email: 'owner@bistrot.demo.neem.ir',
        phone: '+989171111111',
        identity_type: 'restaurant_staff',
        status: 'active',
        mfa_enabled: true,
        metadata: { title: 'مالک و مدیر اجرایی' },
        created_at: new Date('2024-07-01T00:00:00Z'),
        updated_at: new Date('2024-07-01T00:00:00Z')
      }
    ];
    this.tables.neem_tenant_memberships = [
      {
        id: 'mem_westo_01',
        tenant_id: 'westo-demo',
        identity_id: 'usr_westo_owner',
        role: 'owner',
        branch_scope: '*',
        status: 'active',
        active_sessions: 2,
        invited_at: new Date('2024-06-01T00:00:00Z'),
        accepted_at: new Date('2024-06-01T00:00:00Z'),
        revoked_at: null,
        invited_by: 'system',
        revoked_by: null,
        metadata: { activeSessions: 2 },
        created_at: new Date('2024-06-01T00:00:00Z'),
        updated_at: new Date('2024-06-01T00:00:00Z')
      },
      {
        id: 'mem_westo_02',
        tenant_id: 'westo-demo',
        identity_id: 'usr_westo_mgr',
        role: 'manager',
        branch_scope: '*',
        status: 'active',
        active_sessions: 1,
        invited_at: new Date('2024-06-05T00:00:00Z'),
        accepted_at: new Date('2024-06-05T00:00:00Z'),
        revoked_at: null,
        invited_by: 'usr_westo_owner',
        revoked_by: null,
        metadata: { activeSessions: 1 },
        created_at: new Date('2024-06-05T00:00:00Z'),
        updated_at: new Date('2024-06-05T00:00:00Z')
      },
      {
        id: 'mem_westo_03',
        tenant_id: 'westo-demo',
        identity_id: 'usr_westo_cashier_01',
        role: 'cashier',
        branch_scope: 'br_central',
        status: 'active',
        active_sessions: 1,
        invited_at: new Date('2024-06-10T00:00:00Z'),
        accepted_at: new Date('2024-06-10T00:00:00Z'),
        revoked_at: null,
        invited_by: 'usr_westo_mgr',
        revoked_by: null,
        metadata: { activeSessions: 1 },
        created_at: new Date('2024-06-10T00:00:00Z'),
        updated_at: new Date('2024-06-10T00:00:00Z')
      },
      {
        id: 'mem_shiraz_01',
        tenant_id: 'shiraz-bistrot',
        identity_id: 'usr_shiraz_owner',
        role: 'owner',
        branch_scope: '*',
        status: 'active',
        active_sessions: 1,
        invited_at: new Date('2024-07-01T00:00:00Z'),
        accepted_at: new Date('2024-07-01T00:00:00Z'),
        revoked_at: null,
        invited_by: 'system',
        revoked_by: null,
        metadata: { activeSessions: 1 },
        created_at: new Date('2024-07-01T00:00:00Z'),
        updated_at: new Date('2024-07-01T00:00:00Z')
      }
    ];
    this.auditPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this.transactionSnapshot = null;
  }
}

// Singleton database provider
let dbInstance = null;

function createControlPlanePool(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : (
      process.env.DATABASE_SSL === 'true' || config.isProduction ? {
        rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
        ...(process.env.DATABASE_SSL_CA ? { ca: String(process.env.DATABASE_SSL_CA).replace(/\\n/g, '\n') } : {})
      } : undefined
    ),
    max: Math.max(2, Number(process.env.NEEM_DATABASE_POOL_MAX || process.env.DATABASE_POOL_MAX) || 10),
    idleTimeoutMillis: Math.max(5000, Number(process.env.NEEM_DATABASE_IDLE_TIMEOUT_MS || process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.NEEM_DATABASE_CONNECT_TIMEOUT_MS || process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000),
  });

  if (typeof pool.on === 'function') {
    pool.on('error', (err) => {
      console.error('[neem-control-db] unexpected idle client error:', err?.message || err);
    });
  }

  return pool;
}

function getDatabase() {
  if (!dbInstance) {
    if (config.isTest) {
      dbInstance = new InMemoryTestAdapter();
    } else if (config.isProduction) {
      if (!config.databaseUrl) {
        throw new Error('FAIL-CLOSED: NEEM_CONTROL_DATABASE_URL is required in production environment.');
      }
      dbInstance = createControlPlanePool(config.databaseUrl);
    } else {
      // Non-production, non-test environment (e.g. development)
      if (config.databaseUrl) {
        dbInstance = createControlPlanePool(config.databaseUrl);
      } else if (config.allowEphemeralDev || process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV === 'true') {
        console.warn('================================================================================');
        console.warn('[NEEM-CONTROL-PLANE WARNING] EPHEMERAL IN-MEMORY DATABASE ACTIVE.');
        console.warn('DATA WILL NOT PERSIST! BINDING STRICTLY TO LOOPBACK (127.0.0.1).');
        console.warn('THIS MODE IS STRICTLY PROHIBITED IN PRODUCTION.');
        console.warn('================================================================================');
        dbInstance = new InMemoryTestAdapter();
      } else {
        throw new Error('FAIL-CLOSED: PostgreSQL connection string (NEEM_CONTROL_DATABASE_URL) is required in development unless explicit NEEM_CONTROL_ALLOW_EPHEMERAL_DEV=true is provided.');
      }
    }
  }
  return dbInstance;
}

// PostgreSQL exposes `pool.connect()`, while the in-memory test adapter keeps
// the older `getClient()` name. Centralize the compatibility boundary so code
// exercised against a real Pool cannot accidentally call a test-only method.
async function getDatabaseClient(database = getDatabase()) {
  if (database && typeof database.connect === 'function') {
    return database.connect();
  }
  if (database && typeof database.getClient === 'function') {
    return database.getClient();
  }
  throw new Error('DATABASE_CLIENT_UNAVAILABLE: database adapter cannot provide a transaction client.');
}

function getDatabasePoolMetrics(database = getDatabase()) {
  if (!database) return { totalCount: 0, idleCount: 0, waitingCount: 0, type: 'none' };
  if (database instanceof InMemoryTestAdapter || database.isInMemory) {
    return { totalCount: 1, idleCount: 1, waitingCount: 0, type: 'in_memory' };
  }
  return {
    totalCount: typeof database.totalCount === 'number' ? database.totalCount : null,
    idleCount: typeof database.idleCount === 'number' ? database.idleCount : null,
    waitingCount: typeof database.waitingCount === 'number' ? database.waitingCount : null,
    type: 'pg_pool'
  };
}

async function closeDatabase() {
  if (dbInstance) {
    const inst = dbInstance;
    dbInstance = null;
    if (typeof inst.end === 'function') {
      await inst.end();
    }
  }
}

module.exports = {
  getDatabase,
  getDatabaseClient,
  getDatabasePoolMetrics,
  closeDatabase,
  createControlPlanePool,
  InMemoryTestAdapter,
  get db() {
    return getDatabase();
  }
};
