import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, FileCheck2, RefreshCw, ShieldCheck, X, XCircle } from 'lucide-react'
import {
  sureSeatAuth,
  type DriverDocumentType,
  type PendingDriverApplication,
} from '../../services/auth.ts'

const requiredDocuments: { type: DriverDocumentType; label: string }[] = [
  { type: 'ghana_card', label: 'Ghana Card' },
  { type: 'drivers_license', label: "Driver's license" },
  { type: 'vehicle_registration', label: 'Vehicle registration' },
  { type: 'insurance', label: 'Vehicle insurance' },
  { type: 'driver_photo', label: 'Driver photo' },
]

interface DocumentPreview {
  applicationId: string
  documentType: DriverDocumentType
  url: string
  contentType: 'application/pdf' | 'image'
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString()
}

function hasRequiredDocuments(application: PendingDriverApplication) {
  const present = new Set(application.documents.map((document) => document.type))
  return requiredDocuments.every(({ type }) => present.has(type))
}

export default function DriverApplicationReview() {
  const [applications, setApplications] = useState<PendingDriverApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [documentLoading, setDocumentLoading] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [preview, setPreview] = useState<DocumentPreview | null>(null)

  const loadApplications = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setApplications(await sureSeatAuth.listPendingDriverApplications())
    } catch (error) {
      setApplications([])
      setLoadError(error instanceof Error ? error.message : 'Pending Driver applications could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadApplications(), 0)
    return () => window.clearTimeout(timer)
  }, [loadApplications])

  async function openDocument(application: PendingDriverApplication, documentType: DriverDocumentType) {
    const key = `${application.id}:${documentType}`
    setDocumentLoading(key)
    setDocumentError('')
    try {
      const { url, contentType } = await sureSeatAuth.createDriverApplicationDocumentUrl(application.id, documentType)
      setPreview({ applicationId: application.id, documentType, url, contentType })
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'The private Driver document could not be opened.')
    } finally {
      setDocumentLoading('')
    }
  }

  async function review(application: PendingDriverApplication, approved: boolean) {
    const outcome = approved ? 'approve' : 'reject'
    if (!window.confirm(`Are you sure you want to ${outcome} this Driver application?`)) return

    setBusyId(application.id)
    setActionError('')
    setActionMessage('')
    try {
      const result = await sureSeatAuth.reviewDriverApplication(application.id, approved)
      setApplications((current) => current.filter((entry) => entry.id !== application.id))
      setPreview((current) => current?.applicationId === application.id ? null : current)
      if (result.auditVerified) {
        setActionMessage(`Driver application ${approved ? 'approved' : 'rejected'} using the protected review function; its audit entry was verified.`)
      } else {
        setActionError(result.auditError || 'Review completed, but its audit entry could not be verified.')
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not ${outcome} the Driver application.`)
      void loadApplications()
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="identity-review">
      <div className="panel identity-review-intro">
        <span className="stat-icon"><ShieldCheck /></span>
        <div>
          <strong>Private Driver documents</strong>
          <p>Access requires the <code>drivers.approve</code> permission. Each document is opened with a signed URL that expires after 60 seconds.</p>
        </div>
      </div>

      <div className="panel identity-review-panel">
        <div className="section-heading identity-review-heading">
          <div>
            <p className="eyebrow">DRIVER ONBOARDING</p>
            <h2>Pending applications</h2>
            <p className="muted">Review all five required documents before recording a decision.</p>
          </div>
          <button type="button" className="button button-secondary" onClick={() => void loadApplications()} disabled={loading}>
            <RefreshCw />{loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {actionMessage && <p className="auth-feedback auth-success" role="status"><CheckCircle2 />{actionMessage}</p>}
        {actionError && <p className="auth-feedback auth-error" role="alert">{actionError}</p>}
        {documentError && <p className="auth-feedback auth-error" role="alert">{documentError}</p>}
        {loadError && <div className="auth-feedback auth-error" role="alert"><span>{loadError}</span><button type="button" className="text-button" onClick={() => void loadApplications()}>Try again</button></div>}

        {loading
          ? <div className="identity-review-loading" role="status">Loading pending Driver applications…</div>
          : loadError
            ? null
            : applications.length
              ? <div className="identity-review-list">
                {applications.map((application) => {
                  const complete = hasRequiredDocuments(application)
                  const submitted = new Set(application.documents.map((document) => document.type))
                  return (
                    <article className="identity-review-card" key={application.id}>
                      <div className="identity-applicant">
                        <span className="entry-icon"><FileCheck2 /></span>
                        <div>
                          <h3>{application.fullName || 'Driver applicant'}</h3>
                          <p className="identity-user-id">{application.phone || 'No contact number added'} · Account {application.userId}</p>
                        </div>
                        <span className="status-pill">Pending review</span>
                      </div>
                      <dl className="identity-review-meta driver-review-meta">
                        <div><dt>Vehicle registration</dt><dd>{application.vehicleRegistrationNumber}</dd></div>
                        <div><dt>Driving experience</dt><dd>{application.experienceYears} years</dd></div>
                        <div><dt>Submitted</dt><dd>{formatDate(application.createdAt)}</dd></div>
                      </dl>
                      <div className="driver-document-list" aria-label="Required application documents">
                        {requiredDocuments.map(({ type, label }) => {
                          const present = submitted.has(type)
                          const loadingKey = `${application.id}:${type}`
                          return (
                            <div className="driver-document-row" key={type}>
                              <span><FileCheck2 />{label}</span>
                              {present
                                ? <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => void openDocument(application, type)}
                                  disabled={!!documentLoading || !!busyId}
                                >
                                  <ExternalLink />{documentLoading === loadingKey ? 'Opening…' : 'Preview securely'}
                                </button>
                                : <span className="driver-document-missing">Not submitted</span>}
                            </div>
                          )
                        })}
                      </div>
                      {!complete && <p className="auth-feedback auth-warning" role="status">This application is missing required document references. Approval is disabled; reject it or resolve the incomplete submission.</p>}
                      <div className="button-row identity-review-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => void review(application, true)}
                          disabled={!complete || !!busyId || !!documentLoading}
                        >
                          <CheckCircle2 />{busyId === application.id ? 'Saving review…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="button button-danger"
                          onClick={() => void review(application, false)}
                          disabled={!!busyId || !!documentLoading}
                        >
                          <XCircle />{busyId === application.id ? 'Saving review…' : 'Reject'}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
              : <div className="identity-review-empty">
                <CheckCircle2 />
                <h3>No pending applications</h3>
                <p>New Driver applications will appear here after document submission.</p>
              </div>}
      </div>

      {preview && <div className="dialog-backdrop identity-document-backdrop">
        <section className="identity-document-dialog" role="dialog" aria-modal="true" aria-labelledby="driver-document-title">
          <header>
            <div>
              <p className="eyebrow">PRIVATE DRIVER DOCUMENT</p>
              <h2 id="driver-document-title">{requiredDocuments.find(({ type }) => type === preview.documentType)?.label}</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close document preview" onClick={() => setPreview(null)}><X /></button>
          </header>
          <p className="preview-note">Secure preview link expires after 60 seconds. Do not copy or share the link.</p>
          <div className="identity-document-viewer">
            {preview.contentType === 'application/pdf'
              ? <iframe title="Private Driver document preview" src={preview.url} referrerPolicy="no-referrer" />
              : <img src={preview.url} alt="Private Driver document preview" referrerPolicy="no-referrer" />}
          </div>
        </section>
      </div>}
    </section>
  )
}
