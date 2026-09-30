'use strict';

class HttpTrafficController {
  constructor({ endpoint, token, fetchImpl = globalThis.fetch } = {}) {
    this.endpoint = endpoint;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.endpoint && this.token && typeof this.fetchImpl === 'function');
  }

  async revertToStable({ failedVersion, stableVersion, waveId }) {
    if (!this.isConfigured()) {
      const error = new Error('TRAFFIC_CONTROLLER_UNAVAILABLE: traffic rollback adapter is not configured.');
      error.code = 'TRAFFIC_CONTROLLER_UNAVAILABLE';
      throw error;
    }
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
        'idempotency-key': `rollback:${failedVersion}:${waveId}`
      },
      body: JSON.stringify({ action: 'revert_to_stable', failedVersion, stableVersion, waveId })
    });
    let body = null;
    try { body = await response.json(); } catch (_error) { body = null; }
    if (!response.ok || body?.ok !== true || body?.activeVersion !== stableVersion) {
      const error = new Error('TRAFFIC_ROLLBACK_NOT_CONFIRMED: traffic controller did not confirm the requested stable version.');
      error.code = 'TRAFFIC_ROLLBACK_NOT_CONFIRMED';
      error.status = 502;
      throw error;
    }
    return { ok: true, activeVersion: body.activeVersion, operationId: body.operationId || null };
  }
}

module.exports = { HttpTrafficController };
