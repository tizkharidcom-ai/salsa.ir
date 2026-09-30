'use strict';

// Provider contract: https://kavenegar.com/rest.html#Send
// Accepted by the gateway is distinct from delivered to the recipient.
async function dispatchSms(config, entry, { fetchImpl = fetch } = {}) {
  if (config.provider !== 'kavenegar' || !config.apiKey || !config.senderLine) {
    return { status: 'unavailable', error: 'sms_provider_not_configured', costIrr: 0 };
  }
  try {
    const response = await fetchImpl(`https://api.kavenegar.com/v1/${encodeURIComponent(config.apiKey)}/sms/send.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ receptor: entry.phone, message: entry.message, sender: config.senderLine, localid: String(entry.id) }),
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    const payload = await response.json();
    if (!response.ok || payload.return?.status !== 200) return { status: 'failed', error: `sms_provider_${Number(payload.return?.status || response.status)}`, costIrr: 0 };
    const item = payload.entries?.[0];
    if (!item?.messageid) return { status: 'unknown', error: 'sms_receipt_missing', costIrr: 0 };
    return { status: Number(item.status) === 10 ? 'delivered' : 'accepted', providerMessageId: String(item.messageid), providerStatus: Number(item.status), costIrr: Math.max(0, Number(item.cost) || 0) };
  } catch (_) {
    // A timeout may occur after the provider accepted the message. Never
    // retry automatically, and never expose API keys via exception URLs.
    return { status: 'unknown', error: 'sms_delivery_unconfirmed', costIrr: 0 };
  }
}
module.exports = { dispatchSms };
