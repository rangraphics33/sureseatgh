import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, FileCheck2, Mail, Save, ShieldCheck } from 'lucide-react'
import { adminPeopleService, type AdminPersonDetail, type AdminPersonDocument, type AdminPersonRole } from '../../services/adminPeople.ts'
import { sureSeatAuth } from '../../services/auth.ts'

export default function AdminPersonSupportDetails({
  userId,
  role,
  canEdit,
  canResetPassword,
  canReadIdentityDocuments,
  canReadDriverDocuments,
}: {
  userId: string
  role: AdminPersonRole
  canEdit: boolean
  canResetPassword: boolean
  canReadIdentityDocuments: boolean
  canReadDriverDocuments: boolean
}) {
  const [detail, setDetail] = useState<AdminPersonDetail | null>(null)
  const [documents, setDocuments] = useState<AdminPersonDocument[]>([])
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [links, setLinks] = useState<Record<string, string>>({})
  const [openingDocument, setOpeningDocument] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [record, files] = await Promise.all([
        adminPeopleService.getDetail(userId, role),
        adminPeopleService.listDocuments(userId, role, canReadIdentityDocuments, canReadDriverDocuments),
      ])
      setDetail(record); setFullName(record.full_name ?? ''); setPhone(record.phone ?? ''); setDocuments(files)
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Account details could not be loaded.') }
    finally { setLoading(false) }
  }, [canReadDriverDocuments, canReadIdentityDocuments, role, userId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function saveContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await adminPeopleService.updateContact(userId, role, fullName, phone)
      setNotice('Contact details saved. The change was added to the audit log.')
      await load()
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Contact details could not be saved.') }
    finally { setBusy(false) }
  }

  async function sendReset() {
    if (!detail?.user_email) return
    setBusy(true); setError(''); setNotice('')
    try {
      await adminPeopleService.sendPasswordReset(detail.user_email)
      setNotice('A password recovery email has been requested. The account holder must open the email and choose a new password.')
    } catch (resetError) { setError(resetError instanceof Error ? resetError.message : 'The recovery email could not be requested.') }
    finally { setBusy(false) }
  }

  async function prepareDocument(document: AdminPersonDocument) {
    const key = document.id
    setOpeningDocument(key); setError('')
    try {
      const result = document.kind === 'identity'
        ? await sureSeatAuth.createIdentityVerificationDocumentUrl(document.id)
        : await sureSeatAuth.createDriverApplicationDocumentUrl(document.applicationId!, document.documentType as Parameters<typeof sureSeatAuth.createDriverApplicationDocumentUrl>[1])
      setLinks((current) => ({ ...current, [key]: result.url }))
    } catch (documentError) { setError(documentError instanceof Error ? documentError.message : 'The private document could not be opened.') }
    finally { setOpeningDocument('') }
  }

  if (loading) return <div className="person-support-details" role="status">Loading account details…</div>
  if (!detail) return <div className="person-support-details"><p className="auth-feedback auth-error" role="alert">{error || 'Account details are unavailable.'}</p><button className="button button-secondary" onClick={() => void load()}>Try again</button></div>

  return <section className="person-support-details" aria-label={`${role} support details`}>
    <div className="person-support-heading"><div><strong>Support details</strong><small>{detail.user_email}</small></div><span className="status-pill">{detail.account_status}</span></div>
    <div className="people-detail-grid">
      <div><dt>Account created</dt><dd>{new Date(detail.created_at).toLocaleString()}</dd></div>
      <div><dt>Identity verification</dt><dd>{detail.identity_verified_at ? new Date(detail.identity_verified_at).toLocaleDateString() : 'Not approved'}</dd></div>
      {role === 'driver' && <><div><dt>Driver application</dt><dd>{detail.driver_application_status || 'No application'}</dd></div><div><dt>Experience</dt><dd>{detail.experience_years == null ? 'Not provided' : `${detail.experience_years} years`}</dd></div></>}
    </div>
    {canEdit && <form className="person-contact-form" onSubmit={(event) => void saveContact(event)}><h3>Edit contact details</h3><div className="form-grid"><label className="field">Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} required /></label><label className="field">Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} /></label></div><button className="button button-secondary" disabled={busy}><Save />Save changes</button></form>}
    {canResetPassword && <div className="person-reset-action"><div><strong>Password help</strong><small>Send a recovery email; the account holder sets their own password.</small></div><button className="button button-secondary" onClick={() => void sendReset()} disabled={busy}><Mail />Send reset email</button></div>}
    {(canReadIdentityDocuments || canReadDriverDocuments) && <div className="person-document-section"><h3><ShieldCheck /> Uploaded documents</h3>{documents.length === 0 ? <p className="muted">No documents were found for this account.</p> : documents.map((document) => <div className="person-document-row" key={document.id}><span><FileCheck2 /><span><strong>{document.label}</strong><small>{document.status} · {new Date(document.createdAt).toLocaleDateString()}</small></span></span>{links[document.id] ? <a className="text-button" href={links[document.id]} target="_blank" rel="noreferrer"><ExternalLink />Open secure link</a> : <button className="text-button" onClick={() => void prepareDocument(document)} disabled={openingDocument !== ''}><ExternalLink />{openingDocument === document.id ? 'Preparing…' : 'Prepare secure link'}</button>}</div>)}</div>}
    {error && <p className="auth-feedback auth-error" role="alert">{error}</p>}{notice && <p className="auth-feedback auth-success" role="status"><Check />{notice}</p>}
  </section>
}
