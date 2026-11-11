import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, FileCheck2, RefreshCw, ShieldCheck, X, XCircle } from 'lucide-react'
import {
  sureSeatAuth,
  type PendingIdentityVerification,
} from '../../services/auth.ts'

interface DocumentPreview {
  verificationId: string
  url: string
  contentType: 'application/pdf' | 'image'
  applicantName: string
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString()
}

function applicantLabel(userId: string) {
  return `Passenger ${userId.slice(0, 8)}`
}

export default function IdentityVerificationReview() {
  const [applications, setApplications] = useState<PendingIdentityVerification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [documentLoadingId, setDocumentLoadingId] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [preview, setPreview] = useState<DocumentPreview | null>(null)

  const loadApplications = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const results = await sureSeatAuth.listPendingIdentityVerifications()
      setApplications(results)
    } catch (error) {
      setApplications([])
      setLoadError(error instanceof Error ? error.message : 'Pending identity verifications could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadApplications(), 0)
    return () => window.clearTimeout(timer)
  }, [loadApplications])

  async function openDocument(application: PendingIdentityVerification) {
    setDocumentLoadingId(application.id)
    setDocumentError('')
    try {
      const { url, contentType } = await sureSeatAuth.createIdentityVerificationDocumentUrl(application.id)
      setPreview({
        verificationId: application.id,
        url,
        contentType,
        applicantName: applicantLabel(application.userId),
      })
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'The private document could not be opened.')
    } finally {
      setDocumentLoadingId('')
    }
  }

  async function review(application: PendingIdentityVerification, approved: boolean) {
    const outcome = approved ? 'approve' : 'reject'
    if (!window.confirm(`Are you sure you want to ${outcome} this passenger's identity verification?`)) return

    setBusyId(application.id)
    setActionError('')
    setActionMessage('')
    try {
      const result = await sureSeatAuth.reviewIdentityVerification(application.id, approved)
      setApplications((current) => current.filter((entry) => entry.id !== application.id))
      setPreview((current) => current?.verificationId === application.id
        ? null
        : current)
      if (result.auditVerified) {
        setActionMessage(`Verification ${approved ? 'approved' : 'rejected'} and its audit-log entry was verified.`)
      } else {
        setActionError(result.auditError || 'Review completed, but the audit-log entry could not be verified.')
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not ${outcome} the identity verification.`)
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
          <strong>Private identity documents</strong>
          <p>Only accounts with verification-review access can load this queue or open documents. Each preview uses a short-lived signed URL.</p>
        </div>
      </div>

      <div className="panel identity-review-panel">
        <div className="section-heading identity-review-heading">
          <div>
            <p className="eyebrow">IDENTITY & ACCESS</p>
            <h2>Pending verifications</h2>
            <p className="muted">Review each submitted document before recording an approval or rejection.</p>
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
          ? <div className="identity-review-loading" role="status">Loading pending identity verifications…</div>
          : loadError
            ? null
            : applications.length
              ? <div className="identity-review-list">
                {applications.map((application) => (
                  <article className="identity-review-card" key={application.id}>
                    <div className="identity-applicant">
                      <span className="entry-icon"><FileCheck2 /></span>
                      <div>
                        <h3>{applicantLabel(application.userId)}</h3>
                        <p className="identity-user-id">Account ID: {application.userId}</p>
                      </div>
                      <span className="status-pill">Pending review</span>
                    </div>
                    <dl className="identity-review-meta">
                      <div><dt>Submitted</dt><dd>{formatDate(application.createdAt)}</dd></div>
                    </dl>
                    <div className="button-row identity-review-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void openDocument(application)}
                        disabled={!!documentLoadingId || !!busyId}
                      >
                        <ExternalLink />{documentLoadingId === application.id ? 'Opening securely…' : 'View private document'}
                      </button>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void review(application, true)}
                        disabled={!!busyId || !!documentLoadingId}
                      >
                        <CheckCircle2 />{busyId === application.id ? 'Saving review…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() => void review(application, false)}
                        disabled={!!busyId || !!documentLoadingId}
                      >
                        <XCircle />Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              : <div className="identity-review-empty">
                <CheckCircle2 />
                <h3>No pending applications</h3>
                <p>New identity-verification submissions will appear here.</p>
              </div>}
      </div>

      {preview && <div className="dialog-backdrop identity-document-backdrop">
        <section className="identity-document-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-document-title">
          <header>
            <div><p className="eyebrow">PRIVATE DOCUMENT</p><h2 id="identity-document-title">{preview.applicantName}</h2></div>
            <button type="button" className="icon-button" aria-label="Close document preview" onClick={() => setPreview(null)}><X /></button>
          </header>
          <p className="preview-note">Secure preview link expires after 60 seconds. Do not copy or share the link.</p>
          <div className="identity-document-viewer">
            {preview.contentType === 'application/pdf'
              ? <iframe title={`Private identity document for ${preview.applicantName}`} src={preview.url} referrerPolicy="no-referrer" />
              : <img src={preview.url} alt={`Private identity document for ${preview.applicantName}`} referrerPolicy="no-referrer" />}
          </div>
        </section>
      </div>}
    </section>
  )
}
