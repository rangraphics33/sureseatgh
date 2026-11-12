import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, UserRound } from 'lucide-react'
import { getSupabaseClient } from '../../services/supabaseClient.ts'
import AdminPersonSupportDetails from './AdminPersonSupportDetails.tsx'

type DirectoryRole = 'passenger' | 'driver'
interface DirectoryPerson {
  user_id: string
  full_name: string | null
  phone: string | null
  account_status: string
  created_at: string
  identity_verified_at: string | null
  driver_application_status: string | null
  vehicle_type: string | null
  vehicle_registration_number: string | null
  experience_years: number | null
}

export default function AdminPeopleDirectory({ role, onReviewDrivers, canEdit, canResetPassword, canReadIdentityDocuments, canReadDriverDocuments }: {
  role: DirectoryRole
  onReviewDrivers?: () => void
  canEdit: boolean
  canResetPassword: boolean
  canReadIdentityDocuments: boolean
  canReadDriverDocuments: boolean
}) {
  const [people, setPeople] = useState<DirectoryPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [reload, setReload] = useState(0)
  const [expandedId, setExpandedId] = useState('')
  const label = role === 'driver' ? 'Driver' : 'Passenger'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await getSupabaseClient().rpc('admin_list_transport_people', { p_role: role })
      if (queryError) throw queryError
      setPeople((data ?? []) as DirectoryPerson[])
    } catch (loadError) {
      setPeople([])
      setError(loadError instanceof Error ? loadError.message : `${label} records could not be loaded.`)
    } finally {
      setLoading(false)
    }
  }, [label, role])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load, reload])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return people
    return people.filter((person) => [person.full_name, person.phone, person.account_status, person.driver_application_status, person.vehicle_registration_number]
      .some((value) => value?.toLowerCase().includes(term)))
  }, [people, search])

  return <>
    <div className="page-title">
      <div><p className="eyebrow">ADMIN · PEOPLE</p><h1>{label} directory</h1><p className="muted">Account status, contact details and verification information for authorized support.</p></div>
      {role === 'driver' && onReviewDrivers && <button className="button button-primary" onClick={onReviewDrivers}>Review applications</button>}
      <button className="button button-secondary" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw />{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    <div className="people-toolbar"><div className="search-field"><Search /><input aria-label={`Search ${label.toLowerCase()} records`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()} name, phone or status`} /></div><span className="status-pill">{visible.length} accounts</span></div>
    {error && <div className="auth-feedback auth-error" role="alert">{error}<button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
    {loading ? <div className="panel" role="status">Loading authorized account records…</div> : error ? null : visible.length === 0
      ? <div className="panel"><div className="empty-state"><div className="empty-icon"><UserRound /></div><h3>{search ? 'No matching accounts' : `No ${label.toLowerCase()} accounts yet`}</h3><p>{search ? 'Try another name, phone number or status.' : 'New accounts will appear here when they have the appropriate role.'}</p></div></div>
      : <div className="people-directory-grid">{visible.map((person) => <article className="panel people-card" key={person.user_id}>
        <div className="people-card-heading"><span className="avatar avatar-large">{(person.full_name?.trim().charAt(0) || label[0]).toUpperCase()}</span><div><h2>{person.full_name || `${label} account`}</h2><p className="muted">{person.phone || 'No phone number added'}</p></div><span className={`status-pill ${person.account_status === 'restricted' ? 'status-warning' : ''}`}>{person.account_status}</span></div>
        <dl className="people-detail-grid"><div><dt>Member since</dt><dd>{new Date(person.created_at).toLocaleDateString()}</dd></div><div><dt>Identity verification</dt><dd>{person.identity_verified_at ? 'Approved' : 'Not verified'}</dd></div>{role === 'driver' && <><div><dt>Application</dt><dd>{person.driver_application_status || 'No application'}</dd></div><div><dt>Vehicle</dt><dd>{person.vehicle_type || 'Not provided'}{person.vehicle_registration_number ? ` · ${person.vehicle_registration_number}` : ''}</dd></div><div><dt>Driving experience</dt><dd>{person.experience_years == null ? 'Unavailable' : `${person.experience_years} years`}</dd></div></>}</dl>
        <div className="people-card-actions"><small className="people-id">Account ID · {person.user_id}</small><button className="button button-secondary" type="button" aria-expanded={expandedId === person.user_id} onClick={() => setExpandedId((current) => current === person.user_id ? '' : person.user_id)}>{expandedId === person.user_id ? 'Hide details' : 'Support details'}</button></div>
        {expandedId === person.user_id && <AdminPersonSupportDetails userId={person.user_id} role={role} canEdit={canEdit} canResetPassword={canResetPassword} canReadIdentityDocuments={canReadIdentityDocuments} canReadDriverDocuments={canReadDriverDocuments} />}
      </article>)}</div>}
  </>
}
