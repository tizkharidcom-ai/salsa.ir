'use strict';

/**
 * Local OTP disclosure is a development convenience only. Production must
 * never echo an authentication code, even when an operator accidentally sets
 * OTP_DEMO_MODE=true in the deployment environment.
 */
function isOtpDemoMode(env = process.env) {
  const nodeEnv = String(env?.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') return false;
  return String(env?.OTP_DEMO_MODE || '').trim().toLowerCase() !== 'false';
}

module.exports = { isOtpDemoMode };
