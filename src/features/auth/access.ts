export type SureSeatRole = 'passenger' | 'driver' | 'administrator' | 'super_admin' | 'staff'
export type Workspace = 'Passenger' | 'Driver' | 'Admin'
export type AuthPortal = 'passenger' | 'driver' | 'admin'
export type AuthRouteKind = 'login' | 'register' | 'forgot-password' | 'reset-password'

export interface AuthRoute {
  kind: AuthRouteKind
  portal: AuthPortal
}

export interface AccessProfile {
  account_status: 'active' | 'restricted'
  verification_deadline_at: string
  identity_verified_at: string | null
}

export interface AccessContext {
  roles: readonly SureSeatRole[]
  permissions: readonly string[]
  driverApplicationStatus: 'pending' | 'approved' | 'rejected' | null
}

const staffPermissionsByAdminPath: Record<string, readonly string[]> = {
  '/admin/overview': [],
  '/admin/bookings': ['bookings.read', 'bookings.manage'],
  '/admin/trips': ['bookings.read', 'routes.manage'],
  '/admin/drivers': ['drivers.approve'],
  '/admin/driver-applications': ['drivers.approve'],
  '/admin/identity-verification': ['verification.review'],
  '/admin/vehicles': ['vehicles.manage'],
  '/admin/routes': ['routes.manage'],
  '/admin/pickup-points': ['routes.manage'],
  '/admin/passengers': ['passengers.read'],
  '/admin/payments': ['subscriptions.read', 'subscriptions.manage'],
  '/admin/reports-analytics': ['reports.read'],
  '/admin/notifications': ['support.manage'],
}

export function resolveAuthMode(value: string | undefined): 'preview' | 'supabase' | 'invalid' {
  if (value === 'preview') return 'preview'
  if (value === 'supabase' || value === undefined || value === '') return 'supabase'
  return 'invalid'
}

export function resolveAuthRoute(pathname: string): AuthRoute | null {
  const portalPath = pathname.match(/^\/(passenger|driver|admin)\/(login|register|signup)$/)
  if (portalPath) {
    const [, portalSlug, action] = portalPath
    if (portalSlug === 'passenger' && (action === 'register' || action === 'signup')) {
      return { kind: 'register', portal: 'passenger' }
    }
    if (action === 'login') {
      return { kind: 'login', portal: portalSlug as AuthPortal }
    }
    return null
  }

  if (pathname === '/login') return { kind: 'login', portal: 'passenger' }
  if (pathname === '/register') return { kind: 'register', portal: 'passenger' }
  if (pathname === '/forgot-password') return { kind: 'forgot-password', portal: 'passenger' }
  if (pathname === '/reset-password') return { kind: 'reset-password', portal: 'passenger' }
  return null
}

export function getPortalForWorkspacePath(pathname: string): AuthPortal | null {
  const workspace = pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  if (workspace === 'passenger' || workspace === 'driver' || workspace === 'admin') return workspace
  return null
}

export function canSignInToPortal(portal: AuthPortal, access: AccessContext): boolean {
  if (portal === 'passenger') return access.roles.includes('passenger')
  if (portal === 'driver') {
    return access.roles.includes('driver') && access.driverApplicationStatus === 'approved'
  }
  return access.roles.some((role) => ['administrator', 'super_admin', 'staff'].includes(role))
}

export function getWorkspaceOptions(access: AccessContext): Workspace[] {
  const workspaces: Workspace[] = []
  if (access.roles.includes('passenger')) workspaces.push('Passenger')
  if (access.roles.includes('driver') && access.driverApplicationStatus === 'approved') {
    workspaces.push('Driver')
  }
  if (access.roles.includes('administrator') || access.roles.includes('super_admin')
    || (access.roles.includes('staff') && access.permissions.length > 0)) {
    workspaces.push('Admin')
  }
  return workspaces
}

export function canAccessWorkspacePath(pathname: string, access: AccessContext): boolean {
  if (pathname === '/workspace') return getWorkspaceOptions(access).length > 0

  const workspace = pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  if (workspace === 'passenger') return access.roles.includes('passenger')
  if (workspace === 'driver') {
    return access.roles.includes('driver') && access.driverApplicationStatus === 'approved'
  }
  if (workspace !== 'admin') return true

  if (access.roles.includes('administrator') || access.roles.includes('super_admin')) return true
  if (!access.roles.includes('staff')) return false

  const requiredPermissions = staffPermissionsByAdminPath[pathname]
  if (!requiredPermissions) return false
  if (requiredPermissions.length === 0) return access.permissions.length > 0
  return requiredPermissions.some((permission) => access.permissions.includes(permission))
}

export function isAccountRestricted(profile: AccessProfile, now = Date.now()): boolean {
  if (profile.account_status === 'restricted') return true
  if (profile.identity_verified_at) return false
  const deadline = Date.parse(profile.verification_deadline_at)
  return !Number.isFinite(deadline) || deadline <= now
}

export function getSafeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  return value
}
