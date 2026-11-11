import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bus, CalendarDays, CheckCircle2, CreditCard, FileCheck2, RefreshCw, ShieldCheck, Ticket, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  loadAdminDashboard,
  type AdminDashboardAccess,
  type AdminDashboardData,
  type DashboardMetric,
} from '../../services/adminDashboard.ts'

interface AdminDashboardProps {
  access: AdminDashboardAccess
  shortcuts: { label: string; icon: ReactNode; onClick: () => void }[]
  isPreviewMode: boolean
  isSupabaseMode: boolean
}

const metricIcons: Record<string, ReactNode> = {
  Accounts: <UserRound />,
  'Approved driver applications': <CheckCircle2 />,
  'Registered vehicles': <Bus />,
  Bookings: <Ticket />,
  'Active trips': <CalendarDays />,
  'Pending driver applications': <FileCheck2 />,
  'Pending identity reviews': <ShieldCheck />,
  'Payments & subscriptions': <CreditCard />,
}

function MetricCard({ metric, loading }: { metric: DashboardMetric; loading: boolean }) {
  const value = loading
    ? 'Loading'
    : metric.status === 'live'
      ? String(metric.value)
      : metric.status === 'not_connected'
        ? 'Not connected'
        : metric.status === 'access_denied'
          ? 'Restricted'
          : 'Unavailable'
  const detail = loading
    ? 'Retrieving authorized data…'
    : metric.detail

  return (
    <article className="panel stat-card dashboard-metric">
      <div className="stat-top"><span>{metric.label}</span><span className="stat-icon">{metricIcons[metric.label]}</span></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

export default function AdminDashboard({ access, shortcuts, isPreviewMode, isSupabaseMode }: AdminDashboardProps) {
  const [result, setResult] = useState<{ key: string; data: AdminDashboardData | null; error: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const queryAccess = useMemo(() => ({
    roles: access.roles,
    permissions: access.permissions,
  }), [access.roles, access.permissions])
  const requestKey = JSON.stringify([
    isSupabaseMode,
    [...queryAccess.roles].sort(),
    [...queryAccess.permissions].sort(),
    reloadKey,
  ])
  const loading = result?.key !== requestKey
  const data = result?.key === requestKey ? result.data : null
  const error = result?.key === requestKey ? result.error : ''

  useEffect(() => {
    let active = true
    const request = isSupabaseMode
      ? loadAdminDashboard(queryAccess)
      : Promise.resolve({
        metrics: ['Accounts', 'Approved driver applications', 'Registered vehicles', 'Bookings', 'Active trips', 'Pending driver applications', 'Pending identity reviews', 'Payments & subscriptions']
          .map((label) => ({ label, value: null, status: 'not_connected' as const, detail: 'Authentication preview mode has no live database connection.' })),
        activity: [],
        activityStatus: 'not_connected' as const,
        activityDetail: 'Live audit activity is unavailable in authentication preview mode.',
      })
    void request.then((result) => {
      if (active) setResult({ key: requestKey, data: result, error: '' })
    }).catch((loadError: unknown) => {
      if (active) setResult({
        key: requestKey,
        data: null,
        error: loadError instanceof Error ? loadError.message : 'Dashboard data could not be loaded.',
      })
    })
    return () => { active = false }
  }, [isSupabaseMode, queryAccess, requestKey])

  function refresh() {
    setReloadKey((key) => key + 1)
  }

  const metrics = data?.metrics ?? []

  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">SURESEAT · ADMIN</p>
          <h1>Platform overview</h1>
          <p className="muted">Operational data is shown only when its authorized source is connected.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={refresh} disabled={loading}>
          <RefreshCw />Refresh
        </button>
      </div>
      {isPreviewMode && <p className="dashboard-connection-note" role="status">Preview mode is active. No sample figures are shown as live metrics.</p>}
      {error && <div className="panel auth-feedback auth-error" role="alert">{error}</div>}
      <div className="stats-grid dashboard-metrics-grid" aria-live="polite">
        {loading && !metrics.length
          ? ['Accounts', 'Approved driver applications', 'Registered vehicles', 'Bookings', 'Active trips', 'Pending driver applications', 'Pending identity reviews', 'Payments & subscriptions']
            .map((label) => <MetricCard key={label} metric={{ label, value: null, status: 'not_connected', detail: '' }} loading />)
          : metrics.map((metric) => <MetricCard key={metric.label} metric={metric} loading={loading} />)}
      </div>
      <div className="admin-shortcuts">
        {shortcuts.map((item) => <button className="panel shortcut-card" key={item.label} onClick={item.onClick}>
          {item.icon}<strong>{item.label}</strong><ArrowRight />
        </button>)}
      </div>
      <section className="panel admin-activity">
        <div className="panel-heading">
          <div><h2>Recent activity</h2><p className="muted">Administrative audit events</p></div>
          <span className="status-pill">{data?.activityStatus === 'live' ? 'Authorized live data' : 'Access controlled'}</span>
        </div>
        {loading ? <p className="muted" role="status">Loading authorized activity…</p>
          : error ? <p className="auth-feedback auth-error">{error}</p>
            : data?.activityStatus === 'access_denied' ? <p className="muted">{data.activityDetail}</p>
              : data?.activityStatus !== 'live' ? <p className="muted">{data?.activityDetail || 'Activity is unavailable.'}</p>
                : data.activity.length === 0 ? <p className="muted">No audit activity is available.</p>
                  : <div className="admin-activity-list">{data.activity.map((item) => <article key={item.id}>
                    <span className="stat-icon"><ShieldCheck /></span>
                    <div><strong>{item.action.replaceAll('.', ' ')}</strong><small>{new Date(item.created_at).toLocaleString()}{item.subject_user_id ? ` · Account ${item.subject_user_id.slice(0, 8)}` : ''}</small></div>
                  </article>)}</div>}
      </section>
      <p className="sr-only" aria-live="polite">{data?.activityDetail}</p>
    </>
  )
}
