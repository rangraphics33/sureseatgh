import { getSupabaseClient } from './supabaseClient.ts'

export type DashboardMetricStatus = 'live' | 'not_connected' | 'access_denied' | 'error'

export interface DashboardMetric {
  label: string
  value: number | null
  status: DashboardMetricStatus
  detail: string
}

export interface DashboardActivity {
  id: string
  action: string
  created_at: string
  subject_user_id: string | null
}

export interface AdminDashboardData {
  metrics: DashboardMetric[]
  activity: DashboardActivity[]
  activityStatus: DashboardMetricStatus
  activityDetail: string
}

export interface AdminDashboardAccess {
  roles: readonly string[]
  permissions: readonly string[]
}

function isAdministrator(access: AdminDashboardAccess) {
  return access.roles.includes('administrator') || access.roles.includes('super_admin')
}

function canRead(access: AdminDashboardAccess, permission: string) {
  return isAdministrator(access) || access.permissions.includes(permission)
}

function classifyQueryError(error: { code?: string; message: string }): Pick<DashboardMetric, 'status' | 'detail'> {
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return { status: 'not_connected', detail: 'The required database table is not connected.' }
  }
  if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    return { status: 'access_denied', detail: 'Your account does not have permission to view this data.' }
  }
  return { status: 'error', detail: error.message }
}

async function countRows(
  label: string,
  table: 'profiles' | 'driver_applications' | 'vehicles' | 'identity_verifications',
  access: AdminDashboardAccess,
  permission: string,
  status?: string,
): Promise<DashboardMetric> {
  if (!canRead(access, permission)) {
    return {
      label,
      value: null,
      status: 'access_denied',
      detail: `Requires the ${permission} permission.`,
    }
  }

  let query = getSupabaseClient().from(table).select('id', { count: 'exact', head: true })
  if (status) query = query.eq('status', status)
  const { count, error } = await query
  if (error) return { label, value: null, ...classifyQueryError(error) }
  if (count === null) {
    return { label, value: null, status: 'error', detail: 'Supabase did not return a record count.' }
  }
  return { label, value: count, status: 'live', detail: 'Live count from Supabase.' }
}

export async function loadAdminDashboard(access: AdminDashboardAccess): Promise<AdminDashboardData> {
  const [accounts, approvedDrivers, vehicles, bookings, activeTrips, pendingApplications, pendingIdentity] =
    await Promise.all([
      countRows('Accounts', 'profiles', access, 'passengers.read'),
      countRows('Approved driver applications', 'driver_applications', access, 'drivers.approve', 'approved'),
      countRows('Registered vehicles', 'vehicles', access, 'vehicles.manage'),
      Promise.resolve<DashboardMetric>({
        label: 'Bookings',
        value: null,
        status: 'not_connected',
        detail: 'A bookings table or admin reporting endpoint is not defined in the current schema.',
      }),
      Promise.resolve<DashboardMetric>({
        label: 'Active trips',
        value: null,
        status: 'not_connected',
        detail: 'A trips table or admin reporting endpoint is not defined in the current schema.',
      }),
      countRows('Pending driver applications', 'driver_applications', access, 'drivers.approve', 'pending'),
      countRows('Pending identity reviews', 'identity_verifications', access, 'verification.review', 'pending'),
    ])

  const payments: DashboardMetric = {
    label: 'Payments & subscriptions',
    value: null,
    status: 'not_connected',
    detail: 'Payment and subscription reporting is not defined in the current schema.',
  }
  const mayReadAudit = canRead(access, 'audit.read')
  if (!mayReadAudit) {
    return {
      metrics: [accounts, approvedDrivers, vehicles, bookings, activeTrips, pendingApplications, pendingIdentity, payments],
      activity: [],
      activityStatus: 'access_denied',
      activityDetail: 'Recent activity requires the audit.read permission.',
    }
  }

  const { data, error } = await getSupabaseClient()
    .from('audit_logs')
    .select('id, action, created_at, subject_user_id')
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) {
    const classified = classifyQueryError(error)
    return {
      metrics: [accounts, approvedDrivers, vehicles, bookings, activeTrips, pendingApplications, pendingIdentity, payments],
      activity: [],
      activityStatus: classified.status,
      activityDetail: classified.detail,
    }
  }

  return {
    metrics: [accounts, approvedDrivers, vehicles, bookings, activeTrips, pendingApplications, pendingIdentity, payments],
    activity: data ?? [],
    activityStatus: 'live',
    activityDetail: 'Authorized recent audit activity.',
  }
}
