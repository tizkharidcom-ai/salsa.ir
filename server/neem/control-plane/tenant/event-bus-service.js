// server/neem/control-plane/tenant/event-bus-service.js
'use strict';

const EventEmitter = require('events');

/**
 * Scoped Tenant Event Bus
 * Prevents event leakage between tenants by strictly namespacing pub/sub channels.
 */
class TenantEventBusService {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  _channelName(tenantId, eventType) {
    if (!tenantId || !eventType) {
      throw new Error('EVENT_ERROR: Both tenantId and eventType are required.');
    }
    return `tenant:${tenantId}:${eventType}`;
  }

  publish(tenantId, eventType, payload) {
    const channel = this._channelName(tenantId, eventType);
    const eventEnvelope = {
      tenantId,
      eventType,
      payload,
      timestamp: new Date().toISOString()
    };
    this.emitter.emit(channel, eventEnvelope);
    return eventEnvelope;
  }

  subscribe(tenantId, eventType, handler) {
    const channel = this._channelName(tenantId, eventType);
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  reset() {
    this.emitter.removeAllListeners();
  }
}

module.exports = new TenantEventBusService();
