'use strict';

/**
 * Read-only local capacity model for D10.
 *
 * This intentionally does not claim real network/load evidence: it verifies
 * topology placement, noisy-neighbour bulkheads and metric exposition before
 * a disposable/staging load runner is connected.
 */

process.env.NODE_ENV = 'test';
process.env.NEEM_ENV = 'test';

const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { CapacityObservabilityHarness } = require('../server/salsa/control-plane/observability/capacity-harness');

function main() {
  const startedAt = performance.now();
  const harness = new CapacityObservabilityHarness();
  const checks = [];
  const check = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  const stages = [20, 100, 300, 900].map((tenantCount) => {
    const stageStartedAt = performance.now();
    const result = harness.simulateTopologyPlacement(tenantCount);
    return {
      tenant_count: tenantCount,
      active_cells: result.active_cells_count,
      allocations: result.cell_allocations.map((cell) => ({
        cell_id: cell.cell_id,
        current_tenants: cell.current_tenants,
        max_tenants: cell.max_tenants
      })),
      elapsed_ms: Number((performance.now() - stageStartedAt).toFixed(3))
    };
  });
  check('20/100/300/900 topology stages fit declared cell capacity', stages.every((stage) => (
    stage.allocations.every((cell) => cell.current_tenants <= cell.max_tenants)
  )), stages);

  check('901 tenants fail closed at declared 900 capacity', (() => {
    try {
      harness.simulateTopologyPlacement(901);
      return false;
    } catch (error) {
      return /CAPACITY_EXHAUSTED/.test(error.message);
    }
  })());

  const bulkhead = harness.evaluateNoisyNeighbourIsolation({
    cellId: 'cell-teh-01',
    normalTenantRps: 15,
    noisyTenantRps: 250,
    cellMaxConnections: 50
  });
  check('noisy neighbour is throttled without starving healthy tenants',
    bulkhead.noisy_tenant.is_throttled === true &&
    bulkhead.noisy_tenant.allocated_connections === 10 &&
    bulkhead.healthy_neighbours.neighbours_starved === false,
  bulkhead);

  harness.recordHttpRequest({ status: 200, count: 20 });
  harness.recordHttpRequest({ status: 500, count: 1 });
  harness.recordDbConnections({ cell: 'cell-teh-01', active: 12 });
  harness.recordOutboxDepth({ priority: 'normal', depth: 3 });
  harness.recordEdgeSyncLag({ branch: 'central', seconds: 2 });
  const metrics = harness.exportPrometheusMetrics();
  check('Prometheus exposition includes D10 guardrail metrics',
    metrics.includes('neem_http_requests_total') &&
    metrics.includes('neem_tenant_db_connections_active') &&
    metrics.includes('neem_outbox_queue_depth') &&
    metrics.includes('neem_edge_sync_lag_seconds'));

  console.log(JSON.stringify({
    ok: true,
    model: 'local_capacity_model_only',
    checks,
    stages,
    bulkhead,
    elapsed_ms: Number((performance.now() - startedAt).toFixed(3))
  }, null, 2));
}

main();
