'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const identityService = fs.readFileSync(path.join(root, 'server/salsa/control-plane/tenant/identity-service.js'), 'utf8');
const identityRoutes = fs.readFileSync(path.join(root, 'server/salsa/control-plane/routes/identity-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'server/salsa/control-plane/migrations/036_tenant_membership_identity_separation.sql'), 'utf8');

test('tenant invitation rejects platform and guest identities before inserting a membership', () => {
  const inviteStart = identityService.indexOf('async createMembership(');
  const inviteEnd = identityService.indexOf('\n  /**', inviteStart + 1);
  assert.ok(inviteStart >= 0 && inviteEnd > inviteStart);
  const createMembership = identityService.slice(inviteStart, inviteEnd);
  assert.match(createMembership, /identityType !== 'restaurant_staff'[\s\S]*?IDENTITY_TYPE_CONFLICT/);
  assert.match(createMembership, /identity\.identity_type !== 'restaurant_staff'[\s\S]*?IDENTITY_TYPE_CONFLICT/);
  assert.ok(createMembership.indexOf("identity.identity_type !== 'restaurant_staff'") < createMembership.indexOf('INSERT INTO neem_tenant_memberships'));
  assert.match(identityRoutes, /err\.code === 'IDENTITY_TYPE_CONFLICT'[\s\S]*?IDENTITY_TYPE_CONFLICT/);
});

test('database migration fails on existing cross-type memberships and enforces separation in both directions', () => {
  assert.match(migration, /WHERE i\.identity_type <> 'restaurant_staff'/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON neem_tenant_memberships/);
  assert.match(migration, /member_identity_type IS DISTINCT FROM 'restaurant_staff'/);
  assert.match(migration, /FOR SHARE;/,
    'membership insertion must serialize with concurrent non-key identity_type updates');
  assert.doesNotMatch(migration, /FOR KEY SHARE;/,
    'KEY SHARE does not conflict with PostgreSQL NO KEY UPDATE identity_type writes');
  assert.match(migration, /BEFORE UPDATE OF identity_type ON neem_tenant_identities/);
  assert.match(migration, /identity_type_membership_separation/);
});
