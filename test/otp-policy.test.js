'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isOtpDemoMode } = require('../server/otp-policy');

test('production never returns a demo OTP even when the flag is explicitly enabled', () => {
  assert.equal(isOtpDemoMode({ NODE_ENV: 'production', OTP_DEMO_MODE: 'true' }), false);
  assert.equal(isOtpDemoMode({ NODE_ENV: 'PRODUCTION', OTP_DEMO_MODE: 'true' }), false);
});

test('local OTP demo mode is enabled by default but can be explicitly disabled', () => {
  assert.equal(isOtpDemoMode({ NODE_ENV: 'development' }), true);
  assert.equal(isOtpDemoMode({ NODE_ENV: 'test', OTP_DEMO_MODE: 'true' }), true);
  assert.equal(isOtpDemoMode({ NODE_ENV: 'development', OTP_DEMO_MODE: 'false' }), false);
});
