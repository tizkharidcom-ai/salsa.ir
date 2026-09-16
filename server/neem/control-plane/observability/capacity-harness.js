// server/neem/control-plane/observability/capacity-harness.js
'use strict';

const { getDatabase } = require('../db/database');

class CapacityObservabilityHarness {
  constructor() {
    this.db = getDatabase();
    this.cells = [
      { cell_id: 'cell-teh-01', region: 'tehran-central', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-teh-02', region: 'tehran-west', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-teh-03', region: 'tehran-east', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-tbz-01', region: 'tabriz', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-shz-01', region: 'shiraz', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-esf-01', region: 'isfahan', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-mhd-01', region: 'mashhad', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-krz-01', region: 'karaj', max_tenants: 100, current_tenants: 0, db_pool_max: 50 },
      { cell_id: 'cell-ahv-01', region: 'ahvaz', max_tenants: 100, current_tenants: 0, db_pool_max: 50 }
    ];
    this.metrics = new Map();
  }

  /**
   * Partitions tenants across cells based on capacity allocation (AC-61)
   */
  simulateTopologyPlacement(tenantCount = 900) {
    const topology = [];
    const cellAllocations = this.cells.map(c => ({ ...c, current_tenants: 0 }));

    for (let i = 1; i <= tenantCount; i++) {
      const tenantId = `tenant_${String(i).padStart(4, '0')}`;
      // Round-robin placement across non-saturated cells
      const availableCell = cellAllocations.find(c => c.current_tenants < c.max_tenants);
      if (!availableCell) {
        throw new Error(`CAPACITY_EXHAUSTED: Cannot place tenant ${tenantId}. All ${this.cells.length} cells are saturated.`);
      }

      availableCell.current_tenants += 1;
      topology.push({
        tenant_id: tenantId,
        assigned_cell_id: availableCell.cell_id,
        region: availableCell.region
      });
    }

    return {
      total_tenants: tenantCount,
      active_cells_count: cellAllocations.filter(c => c.current_tenants > 0).length,
      cell_allocations: cellAllocations,
      topology_sample: topology.slice(0, 5)
    };
  }

  /**
   * Simulates DB connection pool bulkhead and Noisy Neighbour protection
   */
  evaluateNoisyNeighbourIsolation({ cellId, normalTenantRps = 10, noisyTenantRps = 250, cellMaxConnections = 50 }) {
    // Normal tenants receive fair-share quota
    const maxPerTenantConnections = Math.floor(cellMaxConnections * 0.20); // 20% cap per single tenant
    
    const noisyTenantAllocated = Math.min(noisyTenantRps, maxPerTenantConnections);
    const noisyTenantThrottled = noisyTenantRps > maxPerTenantConnections;
    const remainingPoolForOthers = cellMaxConnections - noisyTenantAllocated;

    return {
      cell_id: cellId,
      cell_max_pool: cellMaxConnections,
      noisy_tenant: {
        requested_rps: noisyTenantRps,
        allocated_connections: noisyTenantAllocated,
        is_throttled: noisyTenantThrottled,
        throttle_reason: 'TENANT_BULKHEAD_QUOTA_EXCEEDED'
      },
      healthy_neighbours: {
        normal_tenant_rps: normalTenantRps,
        available_pool_remaining: remainingPoolForOthers,
        neighbours_starved: remainingPoolForOthers < normalTenantRps
      }
    };
  }

  /**
   * Emits a telemetry metric
   */
  recordMetric(name, value, labels = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name).push({
      value,
      labels,
      timestamp: Date.now()
    });
  }

  recordHttpRequest({ status, cell = 'cell-teh-01', count = 1 } = {}) {
    this.recordMetric('neem_http_requests_total', Number(count) || 0, { status: String(status || 200), cell });
  }

  recordDbConnections({ cell = 'cell-teh-01', active = 0 } = {}) {
    this.recordMetric('neem_tenant_db_connections_active', Number(active) || 0, { cell });
  }

  recordOutboxDepth({ priority = 'normal', depth = 0 } = {}) {
    this.recordMetric('neem_outbox_queue_depth', Number(depth) || 0, { priority });
  }

  recordEdgeSyncLag({ branch = 'central', seconds = 0 } = {}) {
    this.recordMetric('neem_edge_sync_lag_seconds', Number(seconds) || 0, { branch });
  }

  _latest(name, labels, fallback = 0) {
    const entries = this.metrics.get(name) || [];
    const match = entries.filter((entry) => Object.keys(labels).every((key) => String(entry.labels[key]) === String(labels[key])));
    return match.length ? match[match.length - 1].value : fallback;
  }

  _counter(name, labels, fallback = 0) {
    const entries = this.metrics.get(name) || [];
    const match = entries.filter((entry) => Object.keys(labels).every((key) => String(entry.labels[key]) === String(labels[key])));
    return match.length ? match.reduce((total, entry) => total + Number(entry.value || 0), 0) : fallback;
  }

  _labels(labels) {
    return Object.entries(labels).map(([key, value]) => `${key}="${String(value).replaceAll('\\"', '\\\"')}"`).join(',');
  }

  /**
   * Generates standard Prometheus exposition format string
   */
  exportPrometheusMetrics() {
    let output = '';
    output += '# HELP neem_http_requests_total Total incoming platform HTTP requests\n';
    output += '# TYPE neem_http_requests_total counter\n';
    const observedStatuses = (this.metrics.get('neem_http_requests_total') || [])
      .map((entry) => String(entry.labels.status))
      .filter(Boolean);
    const statuses = [...new Set(['200', '401', '500', ...observedStatuses])].sort();
    for (const status of statuses) {
      const labels = { status, cell: 'cell-teh-01' };
      output += `neem_http_requests_total{${this._labels(labels)}} ${this._counter('neem_http_requests_total', labels)}\n`;
    }
    output += '\n';

    output += '# HELP neem_tenant_db_connections_active Active DB connections per cell\n';
    output += '# TYPE neem_tenant_db_connections_active gauge\n';
    for (const cell of ['cell-teh-01', 'cell-teh-02']) {
      const labels = { cell };
      output += `neem_tenant_db_connections_active{${this._labels(labels)}} ${this._latest('neem_tenant_db_connections_active', labels)}\n`;
    }
    output += '\n';

    output += '# HELP neem_outbox_queue_depth Pending outbox synchronization tasks\n';
    output += '# TYPE neem_outbox_queue_depth gauge\n';
    for (const priority of ['high', 'normal']) {
      const labels = { priority };
      output += `neem_outbox_queue_depth{${this._labels(labels)}} ${this._latest('neem_outbox_queue_depth', labels)}\n`;
    }
    output += '\n';

    output += '# HELP neem_edge_sync_lag_seconds P95 latency of edge-to-cloud transaction sync\n';
    output += '# TYPE neem_edge_sync_lag_seconds gauge\n';
    const lagLabels = { branch: 'central' };
    output += `neem_edge_sync_lag_seconds{${this._labels(lagLabels)}} ${this._latest('neem_edge_sync_lag_seconds', lagLabels)}\n`;

    return output;
  }
}

module.exports = {
  CapacityObservabilityHarness
};
