import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAccessWorkspacePath,
  canSignInToPortal,
  getPortalForWorkspacePath,
  getSafeReturnPath,
  getWorkspaceOptions,
  isAccountRestricted,
  resolveAuthRoute,
  resolveAuthMode,
} from '../src/features/auth/access.ts'

test('authentication mode is explicit and rejects unknown values', () => {
  assert.equal(resolveAuthMode('preview'), 'preview')
  assert.equal(resolveAuthMode('supabase'), 'supabase')
  assert.equal(resolveAuthMode(undefined), 'supabase')
  assert.equal(resolveAuthMode('unexpected'), 'invalid')
})

test('workspace eligibility requires an approved driver application', () => {
  const passenger = { roles: ['passenger'], permissions: [], driverApplicationStatus: 'pending' }
  assert.deepEqual(getWorkspaceOptions(passenger), ['Passenger'])
  assert.equal(canAccessWorkspacePath('/driver/overview', passenger), false)
  assert.deepEqual(
    getWorkspaceOptions({ roles: ['passenger', 'driver'], permissions: [], driverApplicationStatus: 'approved' }),
    ['Passenger', 'Driver'],
  )
})

test('portal auth routes are explicit and portal roles remain required', () => {
  assert.deepEqual(resolveAuthRoute('/passenger/login'), { kind: 'login', portal: 'passenger' })
  assert.deepEqual(resolveAuthRoute('/driver/login'), { kind: 'login', portal: 'driver' })
  assert.deepEqual(resolveAuthRoute('/admin/login'), { kind: 'login', portal: 'admin' })
  assert.deepEqual(resolveAuthRoute('/passenger/signup'), { kind: 'register', portal: 'passenger' })
  assert.equal(resolveAuthRoute('/driver/register'), null)
  assert.equal(getPortalForWorkspacePath('/admin/overview'), 'admin')
  assert.equal(getPortalForWorkspacePath('/workspace'), null)
  assert.equal(canSignInToPortal('passenger', { roles: ['passenger'], permissions: [], driverApplicationStatus: null }), true)
  assert.equal(canSignInToPortal('driver', { roles: ['driver'], permissions: [], driverApplicationStatus: 'pending' }), false)
  assert.equal(canSignInToPortal('driver', { roles: ['driver'], permissions: [], driverApplicationStatus: 'approved' }), true)
  assert.equal(canSignInToPortal('admin', { roles: ['staff'], permissions: [], driverApplicationStatus: null }), true)
  assert.equal(canSignInToPortal('admin', { roles: ['passenger'], permissions: [], driverApplicationStatus: null }), false)
})

test('staff admin routes require the corresponding assigned permission', () => {
  const staff = { roles: ['staff'], permissions: ['routes.manage'], driverApplicationStatus: null }
  assert.equal(canAccessWorkspacePath('/admin/routes', staff), true)
  assert.equal(canAccessWorkspacePath('/admin/trips', staff), true)
  assert.equal(canAccessWorkspacePath('/admin/vehicles', staff), false)
  assert.equal(canAccessWorkspacePath('/admin/identity-verification', staff), false)
  assert.equal(canAccessWorkspacePath('/admin/identity-verification', {
    ...staff,
    permissions: ['verification.review'],
  }), true)
  assert.equal(canAccessWorkspacePath('/admin/platform-settings', staff), false)
  assert.equal(canAccessWorkspacePath('/admin/overview', staff), true)
  assert.equal(canAccessWorkspacePath('/admin/staff-access', staff), false)
})

test('Driver application review is limited to drivers.approve', () => {
  const reader = { roles: ['staff'], permissions: ['drivers.read'], driverApplicationStatus: null }
  const reviewer = { roles: ['staff'], permissions: ['drivers.approve'], driverApplicationStatus: null }
  assert.equal(canAccessWorkspacePath('/admin/driver-applications', reader), false)
  assert.equal(canAccessWorkspacePath('/admin/drivers', reader), true)
  assert.equal(canAccessWorkspacePath('/admin/driver-applications', reviewer), true)
  assert.equal(canAccessWorkspacePath('/admin/driver-applications', {
    roles: ['administrator'],
    permissions: [],
    driverApplicationStatus: null,
  }), true)
})

test('administrators can access operational routes while passengers cannot', () => {
  assert.equal(canAccessWorkspacePath('/admin/payments', {
    roles: ['administrator'],
    permissions: [],
    driverApplicationStatus: null,
  }), true)
  assert.equal(canAccessWorkspacePath('/admin/payments', {
    roles: ['passenger'],
    permissions: [],
    driverApplicationStatus: null,
  }), false)
})

test('verification restriction follows the stored status and deadline', () => {
  const deadline = '2026-01-01T00:00:00.000Z'
  assert.equal(isAccountRestricted({
    account_status: 'active',
    verification_deadline_at: deadline,
    identity_verified_at: null,
  }, Date.parse('2025-12-31T23:59:59.000Z')), false)
  assert.equal(isAccountRestricted({
    account_status: 'active',
    verification_deadline_at: deadline,
    identity_verified_at: null,
  }, Date.parse('2026-01-01T00:00:00.000Z')), true)
  assert.equal(isAccountRestricted({
    account_status: 'restricted',
    verification_deadline_at: deadline,
    identity_verified_at: '2025-12-31T00:00:00.000Z',
  }), true)
  assert.equal(isAccountRestricted({
    account_status: 'active',
    verification_deadline_at: deadline,
    identity_verified_at: '2025-12-31T00:00:00.000Z',
  }), false)
})

test('return paths must be local and cannot use protocol-relative or backslash paths', () => {
  assert.equal(getSafeReturnPath('/passenger/booking'), '/passenger/booking')
  assert.equal(getSafeReturnPath('//example.com'), null)
  assert.equal(getSafeReturnPath('/\\example.com'), null)
  assert.equal(getSafeReturnPath('https://example.com'), null)
  assert.equal(getSafeReturnPath(null), null)
})
