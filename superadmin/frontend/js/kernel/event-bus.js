/**
 * prototype/js/kernel/event-bus.js
 * 
 * Resilient, Fault-Tolerant Event Bus for GODMODE Modular Monolith.
 * Ensures that if any event subscriber throws an unhandled error,
 * other subscribers continue executing and the emitting caller is not crashed.
 */

(function registerEventBus(global) {
  'use strict';

  class GMEventBus {
    constructor() {
      this.listeners = new Map();
      this.errorHandlers = [];
    }

    /**
     * Subscribe to an event topic.
     * @param {string} eventName 
     * @param {Function} handler 
     * @param {Object} options - { once: boolean, priority: number }
     * @returns {Function} unsubscribe function
     */
    on(eventName, handler, options = {}) {
      if (typeof handler !== 'function') return () => {};
      if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, []);
      }
      const record = {
        handler,
        once: Boolean(options.once),
        priority: options.priority || 0
      };
      const list = this.listeners.get(eventName);
      list.push(record);
      // Sort by priority descending
      list.sort((a, b) => b.priority - a.priority);

      return () => this.off(eventName, handler);
    }

    /**
     * Subscribe once.
     */
    once(eventName, handler) {
      return this.on(eventName, handler, { once: true });
    }

    /**
     * Unsubscribe a handler.
     */
    off(eventName, handler) {
      if (!this.listeners.has(eventName)) return;
      const list = this.listeners.get(eventName);
      const filtered = list.filter((r) => r.handler !== handler);
      if (filtered.length > 0) {
        this.listeners.set(eventName, filtered);
      } else {
        this.listeners.delete(eventName);
      }
    }

    /**
     * Clear all subscribers for an event or all events.
     */
    clear(eventName) {
      if (eventName) {
        this.listeners.delete(eventName);
      } else {
        this.listeners.clear();
      }
    }

    /**
     * Register a callback for caught listener errors.
     */
    onError(errorHandler) {
      if (typeof errorHandler === 'function') {
        this.errorHandlers.push(errorHandler);
      }
      return () => {
        this.errorHandlers = this.errorHandlers.filter((h) => h !== errorHandler);
      };
    }

    /**
     * Emit an event. All listeners execute in isolated try/catch boundaries.
     * @param {string} eventName 
     * @param {*} payload 
     * @returns {Array} array of execution results/errors
     */
    emit(eventName, payload) {
      if (!this.listeners.has(eventName)) return [];
      const list = [...this.listeners.get(eventName)];
      const results = [];

      for (const record of list) {
        if (record.once) {
          this.off(eventName, record.handler);
        }
        try {
          const res = record.handler(payload);
          results.push({ success: true, result: res });
        } catch (err) {
          console.error(`[GMEventBus] Error in listener for "${eventName}":`, err);
          results.push({ success: false, error: err });
          // Notify error handlers
          for (const errHandler of this.errorHandlers) {
            try {
              errHandler({ eventName, error: err, payload });
            } catch (ehError) {
              console.error('[GMEventBus] Error in custom error handler:', ehError);
            }
          }
        }
      }

      return results;
    }

    /**
     * Check if an event has subscribers.
     */
    hasListeners(eventName) {
      return this.listeners.has(eventName) && this.listeners.get(eventName).length > 0;
    }
  }

  const instance = new GMEventBus();
  global.GMEventBus = instance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GMEventBus, defaultEventBus: instance };
  }
})(typeof window !== 'undefined' ? window : global);
