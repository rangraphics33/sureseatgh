import { useCallback, useEffect, useState } from 'react'
import { Copy, MailPlus, RefreshCw, UserRound, X } from 'lucide-react'
import { getSupabaseClient } from '../../services/supabaseClient.ts'
import AdminPersonSupportDetails from './AdminPersonSupportDetails.tsx'

const departments = {
  'Passenger support': ['passengers.read', 'support.manage'],
  'Driver onboarding': ['drivers.read', 'drivers.approve'],
  'Routes & operations': ['routes.read', 'routes.manage', 'bookings.read', 'bookings.manage'],
  'Fleet': ['vehicles.manage'],
  'Payments': ['subscriptions.read', 'subscriptions.manage'],
  'Verification': ['verification.review'],
  'Reporting & audit': ['reports.read', 'audit.read'],
} as const
type Permission = (typeof departments)[keyof typeof departments][number]
const departmentEntries = Object.entries(departments) as [string, readonly Permission[]][]
interface StaffUser { id: string; name: string | null; email: string; permissions: string[] }
interface Invitation { id: string; email: string; requested_permissions: string[]; expires_at: string; created_at: string }

function failure(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }

export default function StaffAccessManagement() {
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [expandedStaffId, setExpandedStaffId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const client = getSupabaseClient()
      const [rolesResult, invitesResult, acceptedResult] = await Promise.all([
        client.from('user_roles').select('user_id, created_at').eq('role', 'staff'),
        client.from('admin_invitations').select('id, email, requested_permissions, expires_at, created_at').eq('status', 'pending').eq('invited_role', 'staff').order('created_at', { ascending: false }),
        client.from('admin_invitations').select('accepted_by, email').eq('status', 'accepted').eq('invited_role', 'staff'),
      ])
      if (rolesResult.error) throw rolesResult.error
      if (invitesResult.error) throw invitesResult.error
      if (acceptedResult.error) throw acceptedResult.error
      const ids = [...new Set((rolesResult.data ?? []).map((row) => row.user_id))]
      const emails = new Map((acceptedResult.data ?? []).filter((row) => row.accepted_by).map((row) => [row.accepted_by as string, row.email as string]))
      if (!ids.length) { setStaff([]); setInvitations((invitesResult.data ?? []) as Invitation[]); return }
      const [profilesResult, permissionsResult] = await Promise.all([
        client.from('profiles').select('id, full_name').in('id', ids),
        client.from('staff_permission_assignments').select('staff_user_id, permission_code').in('staff_user_id', ids),
      ])
      if (profilesResult.error) throw profilesResult.error
      if (permissionsResult.error) throw permissionsResult.error
      const profiles = new Map((profilesResult.data ?? []).map((row) => [row.id, row.full_name]))
      const grants = new Map<string, string[]>()
      for (const row of permissionsResult.data ?? []) grants.set(row.staff_user_id, [...(grants.get(row.staff_user_id) ?? []), row.permission_code])
      setStaff(ids.map((id) => ({ id, name: profiles.get(id) ?? null, email: emails.get(id) ?? '', permissions: grants.get(id) ?? [] })))
      setInvitations((invitesResult.data ?? []) as Invitation[])
    } catch (loadError) {
      setError(failure(loadError, 'Staff access could not be loaded.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load, reload])

  async function createInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage(''); setInviteLink('')
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc('issue_admin_invitation', {
        p_email: email.trim().toLowerCase(), p_role: 'staff', p_staff_permissions: selectedPermissions,
      })
      if (rpcError) throw rpcError
      if (typeof data !== 'string' || !data) throw new Error('The invitation was created but no secure token was returned.')
      setInviteLink(`${window.location.origin}/accept-invitation?token=${encodeURIComponent(data)}`)
      setEmail(''); setSelectedPermissions([]); setMessage('Invitation created. Copy this one-time link and send it to the staff member.')
      setReload((value) => value + 1)
    } catch (inviteError) { setError(failure(inviteError, 'Staff invitation could not be created.')) }
    finally { setBusy(false) }
  }

  async function changePermission(userId: string, permission: Permission, granted: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      const { error: rpcError } = await getSupabaseClient().rpc('set_staff_permission', {
        p_staff_user_id: userId, p_permission_code: permission, p_granted: granted,
      })
      if (rpcError) throw rpcError
      setMessage('Staff access updated and recorded.')
      setReload((value) => value + 1)
    } catch (changeError) { setError(failure(changeError, 'Staff access could not be changed.')) }
    finally { setBusy(false) }
  }

  async function revoke(invitationId: string) {
    setBusy(true); setError('')
    try {
      const { error: rpcError } = await getSupabaseClient().rpc('revoke_admin_invitation', { p_invitation_id: invitationId })
      if (rpcError) throw rpcError
      setMessage('Invitation revoked.')
      setReload((value) => value + 1)
    } catch (revokeError) { setError(failure(revokeError, 'Invitation could not be revoked.')) }
    finally { setBusy(false) }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(inviteLink); setMessage('Invitation link copied.') }
    catch { setError('Clipboard access failed. Select and copy the invitation link manually.') }
  }

  return <>
    <div className="page-title"><div><p className="eyebrow">ADMIN · ACCESS CONTROL</p><h1>Staff & departments</h1><p className="muted">Invite staff and grant only the permissions needed for their work.</p></div><button className="button button-secondary" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw />Refresh</button></div>
    {error && <p className="auth-feedback auth-error" role="alert">{error}</p>}{message && <p className="auth-feedback auth-success" role="status">{message}</p>}
    {inviteLink && <section className="panel invite-link-panel"><div><strong>Staff invitation link</strong><p className="muted">Share it only with the intended person. It expires automatically and is shown here only once.</p></div><code>{inviteLink}</code><button className="button button-secondary" onClick={() => void copyLink()}><Copy />Copy link</button></section>}
    <section className="panel staff-invite-panel"><div className="section-heading"><div><h2>Invite staff member</h2><p className="muted">They can use an existing SureSeat account or create one before accepting.</p></div><MailPlus /></div><form className="staff-invite-form" onSubmit={(event) => void createInvite(event)}><label className="field">Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required /></label><fieldset className="department-options"><legend>Departments and access</legend>{departmentEntries.map(([department, permissions]) => <label className="department-choice" key={department}><input type="checkbox" checked={permissions.every((permission) => selectedPermissions.includes(permission))} onChange={(event) => setSelectedPermissions((current) => event.target.checked ? [...new Set([...current, ...permissions])] : current.filter((permission) => !permissions.includes(permission)))} /><span><strong>{department}</strong><small>{permissions.join(' · ')}</small></span></label>)}</fieldset><button className="button button-primary" disabled={busy}>{busy ? 'Creating invitation…' : 'Create staff invitation'} <MailPlus /></button></form></section>
    <section className="panel staff-list-panel"><div className="section-heading"><div><h2>Active staff</h2><p className="muted">Permission changes take effect immediately.</p></div><span className="status-pill">{staff.length} staff</span></div>
      {loading ? <p className="muted" role="status">Loading staff access…</p> : staff.length === 0 ? <p className="muted">No active staff accounts have accepted an invitation.</p> : staff.map((person) => <article className="staff-user-card" key={person.id}><div className="people-card-heading"><span className="avatar"><UserRound /></span><div><strong>{person.name || 'Staff account'}</strong><small>{person.email || person.id}</small></div></div><div className="staff-department-grid">{departmentEntries.map(([department, permissions]) => <label className="department-choice" key={department}><input type="checkbox" checked={permissions.some((permission) => person.permissions.includes(permission))} disabled={busy} onChange={(event) => { const next = event.target.checked; for (const permission of permissions) if (person.permissions.includes(permission) !== next) void changePermission(person.id, permission, next) }} /><span><strong>{department}</strong><small>{permissions.filter((permission) => person.permissions.includes(permission)).length}/{permissions.length} permissions enabled</small></span></label>)}</div><button type="button" className="button button-secondary" onClick={() => setExpandedStaffId((current) => current === person.id ? '' : person.id)} aria-expanded={expandedStaffId === person.id}>{expandedStaffId === person.id ? 'Hide details' : 'Staff details & password help'}</button>{expandedStaffId === person.id && <AdminPersonSupportDetails userId={person.id} role="staff" canEdit canResetPassword canReadIdentityDocuments={false} canReadDriverDocuments={false} />}</article>)}
    </section>
    <section className="panel staff-list-panel"><div className="section-heading"><div><h2>Pending invitations</h2><p className="muted">An invitation is accepted after the person signs in with the matching email.</p></div><span className="status-pill">{invitations.length} pending</span></div>{invitations.length === 0 ? <p className="muted">No pending invitations.</p> : invitations.map((invitation) => <article className="pending-invite-row" key={invitation.id}><div><strong>{invitation.email}</strong><small>{invitation.requested_permissions.join(' · ') || 'No departments assigned'} · Expires {new Date(invitation.expires_at).toLocaleDateString()}</small></div><button className="button button-danger" disabled={busy} onClick={() => void revoke(invitation.id)}><X />Revoke</button></article>)}</section>
  </>
}
