'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/reservations', async (req, res) => {
  const settings = __westoModuleContext.db.reservationSettings || {};
  const sendError = (status, code, message) => res.status(status).json({ ok: false, error: code, code, message });
  const rawKey = String(req.get('Idempotency-Key') || '').trim();
  if (process.env.NODE_ENV === 'production' && !rawKey) {
    return sendError(400, 'idempotency_key_required', 'برای ثبت رزرو، کلید درخواست لازم است.');
  }
  if (rawKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(rawKey)) {
    return sendError(400, 'idempotency_key_invalid', 'کلید درخواست معتبر نیست.');
  }

  const candidateBody = req.body;
  const bodyPrototype = candidateBody && typeof candidateBody === 'object'
    ? Object.getPrototypeOf(candidateBody)
    : null;
  const body = candidateBody
    && typeof candidateBody === 'object'
    && !Array.isArray(candidateBody)
    && (bodyPrototype === Object.prototype || bodyPrototype === null)
    ? candidateBody
    : null;
  if (!body) return sendError(400, 'reservation_body_invalid', 'بدنهٔ درخواست رزرو معتبر نیست.');
  const name = String(body.name || '').trim().normalize('NFC').slice(0, 80);
  const phone = __westoModuleContext.normalizeDigits(body.phone || '').trim();
  const dateStr = __westoModuleContext.normalizeReservationDate(body.date);
  const dateFingerprintValue = dateStr || __westoModuleContext.normalizeDigits(String(body.date || '')).trim().slice(0, 32);
  const time = __westoModuleContext.normalizeDigits(String(body.time || '')).trim();
  const note = String(body.note || '').trim().normalize('NFC').slice(0, 200);
  const maxParty = Math.max(1, Number(settings.maxParty) || 12);
  const rawPartySize = body.partySize == null || String(body.partySize).trim() === ''
    ? '2'
    : __westoModuleContext.normalizeDigits(body.partySize);
  const partySize = Number(rawPartySize);
  const branchValue = body.branchId ?? body.branch;
  const branch = __westoModuleContext.resolveBranchExact(branchValue);

  const idempotencyKey = rawKey || __westoModuleContext.crypto.randomUUID();
  const fingerprint = __westoModuleContext.reservationFingerprint({
    branchId: branch ? Number(branch.id) : __westoModuleContext.normalizeDigits(String(branchValue || '')).trim().toLowerCase(),
    date: dateFingerprintValue,
    time,
    partySize: Number.isSafeInteger(partySize) ? partySize : String(rawPartySize).trim(),
    name,
    phone,
    note,
  });

  let outcome;
  try {
    outcome = await __westoModuleContext.serializeReservationCreation(async () => {
      const idempotency = __westoModuleContext.db.reservationIdempotency && typeof __westoModuleContext.db.reservationIdempotency === 'object'
        ? __westoModuleContext.db.reservationIdempotency
        : {};
      const prior = Object.prototype.hasOwnProperty.call(idempotency, idempotencyKey)
        ? idempotency[idempotencyKey]
        : null;
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          return { error: { status: 409, code: 'idempotency_key_conflict', message: 'این کلید قبلاً برای اطلاعات رزرو دیگری استفاده شده است.' } };
        }
        const existing = (__westoModuleContext.db.reservations || []).find((item) => Number(item.id) === Number(prior.reservationId));
        if (!existing) {
          return { error: { status: 409, code: 'reservation_idempotency_result_unavailable', message: 'نتیجهٔ این کلید دیگر در سابقهٔ رزروها موجود نیست.' } };
        }
        const existingBranch = (__westoModuleContext.db.branches || []).find((item) => Number(item.id) === Number(existing.branchId)) || branch;
        return { reservation: existing, branch: existingBranch, replay: true };
      }

      if (!name) return { error: { status: 400, code: 'reservation_name_required', message: 'نام لازم است.' } };
      if (!__westoModuleContext.PHONE_RE.test(phone)) return { error: { status: 400, code: 'reservation_phone_invalid', message: 'شماره موبایل معتبر نیست.' } };
      if (!dateStr) return { error: { status: 400, code: 'reservation_date_invalid', message: 'تاریخ معتبر نیست.' } };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return { error: { status: 400, code: 'reservation_time_invalid', message: 'ساعت معتبر نیست.' } };
      }
      if (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > maxParty) {
        return { error: { status: 400, code: 'reservation_party_size_invalid', message: `تعداد نفرات باید بین ۱ تا ${maxParty} باشد.` } };
      }
      if (!branch || branch.active === false) {
        return { error: { status: 400, code: 'reservation_branch_invalid', message: 'شعبهٔ فعال یافت نشد.' } };
      }
      if (settings.enabled === false) {
        return { error: { status: 403, code: 'reservations_disabled', message: 'رزرو غیرفعال است.' } };
      }
      if (!__westoModuleContext.reservationDateWithinWindow(dateStr, settings)) {
        return { error: { status: 400, code: 'reservation_date_out_of_range', message: 'تاریخ رزرو خارج از بازهٔ مجاز است.' } };
      }
      const { slots, closed } = __westoModuleContext.listReservationSlots(branch, dateStr, partySize);
      if (closed) {
        return { error: { status: 409, code: 'reservation_day_closed', message: 'در این روز مجموعه تعطیل است.' } };
      }
      const slot = slots.find((item) => item.time === time);
      if (!slot || !slot.available) {
        return { error: { status: 409, code: 'reservation_slot_unavailable', message: 'این ساعت در حال حاضر ظرفیت ندارد.' } };
      }

      const hadReservations = Object.prototype.hasOwnProperty.call(__westoModuleContext.db, 'reservations');
      const reservationsBefore = Array.isArray(__westoModuleContext.db.reservations) ? __westoModuleContext.db.reservations.slice() : __westoModuleContext.db.reservations;
      const hadIdempotency = Object.prototype.hasOwnProperty.call(__westoModuleContext.db, 'reservationIdempotency');
      const idempotencyBefore = __westoModuleContext.db.reservationIdempotency;
      const hadAuditLog = Object.prototype.hasOwnProperty.call(__westoModuleContext.db, 'auditLog');
      const auditLogBefore = Array.isArray(__westoModuleContext.db.auditLog) ? __westoModuleContext.db.auditLog.slice() : __westoModuleContext.db.auditLog;
      const id = Math.max(0, ...(__westoModuleContext.db.reservations || []).map((item) => Number(item.id) || 0)) + 1;
      const createdAt = new Date().toISOString();
      const reservation = {
        id,
        branchId: branch.id,
        name,
        phone,
        partySize,
        date: dateStr,
        time,
        endTime: '',
        note,
        status: 'pending',
        createdAt,
        statusAt: createdAt,
      };

      __westoModuleContext.db.reservations = [reservation, ...(Array.isArray(__westoModuleContext.db.reservations) ? __westoModuleContext.db.reservations : [])].slice(0, 1000);
      __westoModuleContext.db.reservationIdempotency = {
        ...idempotency,
        [idempotencyKey]: { fingerprint, reservationId: id, createdAt },
      };
      const auditEntry = __westoModuleContext.recordAudit(null, 'reservation.created', 'reservation', id, { partySize }, branch.id, { deferAppend: true });

      try {
        const persisted = await __westoModuleContext.save({ requireDurable: true });
        if (persisted !== true) throw Object.assign(new Error('Reservation persistence was not confirmed.'), { code: 'reservation_persistence_unconfirmed', status: 503 });
      } catch (error) {
        if (hadReservations) __westoModuleContext.db.reservations = reservationsBefore;
        else delete __westoModuleContext.db.reservations;
        if (hadIdempotency) __westoModuleContext.db.reservationIdempotency = idempotencyBefore;
        else delete __westoModuleContext.db.reservationIdempotency;
        if (hadAuditLog) __westoModuleContext.db.auditLog = auditLogBefore;
        else delete __westoModuleContext.db.auditLog;
        console.error('[reservation] durable commit failed', error?.message || error);
        return { error: { status: 503, code: 'reservation_persistence_failed', message: 'رزرو ذخیره نشد؛ لطفاً با همین درخواست دوباره تلاش کنید.' } };
      }

      __westoModuleContext.appendAuditAfterCommit(auditEntry);
      return { reservation, branch, replay: false };
    });
  } catch (error) {
    console.error('[reservation] creation failed', error?.message || error);
    return sendError(503, 'reservation_creation_failed', 'ثبت رزرو موقتاً انجام نشد.');
  }

  if (outcome.error) return sendError(outcome.error.status, outcome.error.code, outcome.error.message);
  const reservation = outcome.reservation;
  const responseBranch = outcome.branch || branch;
  if (outcome.replay) {
    return res.status(200).json({ ok: true, idempotentReplay: true, reservation: __westoModuleContext.reservationResponse(reservation, responseBranch), whatsapp: null });
  }

  let notify = null;
  try {
    __westoModuleContext.publishOperationalEvent('reservation.created', { reservationId: reservation.id, branchId: reservation.branchId, status: reservation.status });
  } catch (error) {
    console.error('[reservation] post-commit event failed', error?.message || error);
  }
  try {
    notify = await __westoModuleContext.notifyReservationWhatsApp(__westoModuleContext.db, reservation);
    if (!notify?.skipped) await __westoModuleContext.save({ requireDurable: true });
  } catch (error) {
    // The durable reservation and idempotency record already committed. Never
    // turn a notification error into a retryable create failure.
    console.error('[reservation] post-commit notification failed', error?.message || error);
    notify = null;
  }

  return res.status(201).json({
    ok: true,
    idempotentReplay: false,
    reservation: __westoModuleContext.reservationResponse(reservation, responseBranch),
    whatsapp: notify?.skipped ? null : notify,
  });
});
};
