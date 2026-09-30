// server/salsa/control-plane/routes/overview-routes.js
'use strict';

const express = require('express');
const { authenticatePlatform } = require('../auth/auth-middleware');
const tenantRegistry = require('../registry/tenant-service');
const auditService = require('../audit/audit-service');

const router = express.Router();

router.get('/', authenticatePlatform, async (req, res) => {
  try {
    const tenants = await tenantRegistry.listTenants();
    const recentAudits = await auditService.listEvents({ limit: 10 });

    const activeCount = tenants.filter(t => t.status === 'active').length;
    const provisioningCount = tenants.filter(t => t.status === 'provisioning').length;
    const suspendedCount = tenants.filter(t => t.status === 'suspended').length;
    const cellCounts = tenants.reduce((counts, tenant) => {
      const cellId = tenant.cell_id || tenant.cellId || 'unassigned';
      counts.set(cellId, (counts.get(cellId) || 0) + 1);
      return counts;
    }, new Map());
    const cells = [...cellCounts.entries()].map(([id, tenantCount]) => ({
      id,
      health: 'unknown',
      tenantCount,
      healthReason: 'No cell probe telemetry was supplied to the overview endpoint.'
    }));

    return res.status(200).json({
      success: true,
      data: {
        platform: {
          name: 'SALSA CONTROL PLANE',
          edition: 'GODMODE V1',
          version: '2.0.0',
          mode: 'fail_closed'
        },
        metrics: {
          totalTenants: tenants.length,
          activeTenants: activeCount,
          provisioningTenants: provisioningCount,
          suspendedTenants: suspendedCount,
          cellsCount: cells.length,
          mfaEnforcement: 'STRICT_RFC6238',
          auditStatus: recentAudits.length > 0 ? 'EVENTS_AVAILABLE' : 'NO_EVENTS'
        },
        cells,
        recentAuditFeed: recentAudits.slice(0, 10).map(a => {
          const rawActorId = a.actor_id || a.actorId;
          const isLegacy = !rawActorId || rawActorId === 'null' || rawActorId === 'undefined';
          return {
            id: a.id,
            action: a.action,
            actorId: isLegacy ? null : rawActorId,
            actorRole: a.actor_role || a.actorRole || null,
            isLegacyOrUnknown: isLegacy,
            targetType: a.target_type || a.targetType,
            targetId: a.target_id || a.targetId,
            occurredAt: a.occurred_at || a.occurredAt
          };
        })
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'OVERVIEW_ERROR', message: err.message }
    });
  }
});

module.exports = router;
