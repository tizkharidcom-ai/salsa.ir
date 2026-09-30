'use strict';

function createSettlementPersistenceGate({ environment = () => process.env.NODE_ENV } = {}) {
  let uncertainWrite = null;

  function unavailable(code, message) {
    return { ok: false, status: 503, code, message };
  }

  return Object.freeze({
    check({ postgresEnabled, postgresRequired } = {}) {
      if (environment() !== 'production') return { ok: true };
      if (uncertainWrite) {
        return unavailable(
          'settlement_reconciliation_required',
          'وضعیت آخرین ذخیرهٔ پایدار قطعی نیست؛ وجه را دوباره دریافت نکنید. ابتدا پرداخت، رسید و پایگاه داده را تطبیق دهید و سپس سرویس را با snapshot معتبر راه‌اندازی کنید.',
        );
      }
      if (postgresEnabled !== true || postgresRequired !== true) {
        return unavailable(
          'production_postgres_authority_required',
          'دریافت وجه در تولید تا فعال و اجباری‌شدن PostgreSQL به‌عنوان مرجع پایدار غیرفعال است.',
        );
      }
      return { ok: true };
    },

    recordFailure(error) {
      if (environment() !== 'production' || uncertainWrite) return uncertainWrite;
      const rawCode = String(error?.code || 'durable_write_failed');
      uncertainWrite = Object.freeze({
        code: /^[A-Za-z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : 'durable_write_failed',
        at: new Date().toISOString(),
      });
      return uncertainWrite;
    },

    uncertainty() {
      return uncertainWrite;
    },
  });
}

module.exports = { createSettlementPersistenceGate };
