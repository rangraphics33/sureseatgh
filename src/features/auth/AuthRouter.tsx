import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import App from '../../App.tsx'
import type { DriverDocumentType } from '../../services/auth.ts'
import {
  canAccessWorkspacePath,
  canSignInToPortal,
  getPortalForWorkspacePath,
  getSafeReturnPath,
  getWorkspaceOptions,
  isAccountRestricted,
  resolveAuthRoute,
} from './access.ts'
import type { AuthPortal } from './access.ts'
import AuthScreen from './AuthScreen.tsx'
import type { AuthScreenKind } from './AuthScreen.tsx'
import { useAuth } from './authContext.ts'

const requiredDriverDocuments = [
  { key: 'ghana_card', label: 'Ghana Card', accept: 'image/jpeg,image/png,application/pdf' },
  { key: 'drivers_license', label: "Driver's license", accept: 'image/jpeg,image/png,application/pdf' },
  { key: 'vehicle_registration', label: 'Vehicle registration document', accept: 'image/jpeg,image/png,application/pdf' },
  { key: 'insurance', label: 'Valid vehicle insurance', accept: 'image/jpeg,image/png,application/pdf' },
  { key: 'driver_photo', label: 'Recent driver photo', accept: 'image/jpeg,image/png,image/webp' },
] as const

function hasAllDriverDocuments(
  documents: Partial<Record<DriverDocumentType, File>>,
): documents is Record<DriverDocumentType, File> {
  return requiredDriverDocuments.every(({ key }) => documents[key] !== undefined)
}

function LoadingPage({ message }: { message: string }) {
  return <main className="entry-page"><div className="entry-content"><p className="eyebrow">SURESEAT ACCOUNT</p><h1>{message}</h1><p className="entry-detail" role="status">Please wait while your account access is checked.</p></div></main>
}

function AccessMessage({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <main className="entry-page"><div className="entry-content"><p className="eyebrow">SURESEAT ACCOUNT</p><h1>{title}</h1><p className="entry-detail">{detail}</p>{action}</div></main>
}

function WorkspacePicker() {
  const { snapshot, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState('')
  if (!snapshot) return <AccessMessage title="No workspace is available" detail="Sign in with a SureSeat account that has an assigned role." action={<a className="button button-primary" href="/login">Sign in <ArrowRight /></a>} />

  const workspaces = getWorkspaceOptions(snapshot)
  const paths = {
    Passenger: '/passenger/home',
    Driver: '/driver/overview',
    Admin: '/admin/overview',
  } as const
  const descriptions = {
    Passenger: 'Plan journeys, manage bookings and view your subscriptions.',
    Driver: 'View assigned trips and driver tools.',
    Admin: 'Open only the operational areas allowed by your assigned access.',
  } as const

  return (
    <main className="entry-page">
      <div className="entry-content">
        <p className="eyebrow">SURESEAT ACCOUNT</p>
        <h1>Choose a workspace</h1>
        <p className="entry-detail">Your account may use more than one workspace. Choose where you want to continue.</p>
        {isAccountRestricted(snapshot.profile) && <VerificationNotice />}
        <div className="entry-choices">
          {workspaces.map((workspace) => (
            <a className="panel entry-choice" key={workspace} href={paths[workspace]}>
              <span className="entry-icon"><ShieldCheck /></span>
              <span className="entry-choice-copy"><strong>{workspace} workspace</strong><small>{descriptions[workspace]}</small></span>
              <ArrowRight />
            </a>
          ))}
          {workspaces.length === 0 && <p className="auth-feedback auth-error" role="alert">No approved workspace is assigned. If you have applied to become a Driver, check the application status below.</p>}
        </div>
        {snapshot.driverApplicationStatus && <p className="entry-preview-note">Driver application: <strong>{snapshot.driverApplicationStatus}</strong>{snapshot.driverApplicationStatus !== 'approved' && <> · <a href="/driver-application">View application</a></>}</p>}
        {signOutError && <p className="auth-feedback auth-error" role="alert">{signOutError}</p>}
        <div className="auth-links"><a href="/driver-application">Apply to become a Driver</a><button type="button" className="text-button" onClick={() => void signOut().then(() => window.location.assign('/')).catch((error: unknown) => setSignOutError(error instanceof Error ? error.message : 'Could not sign out.'))}>Sign out</button></div>
      </div>
    </main>
  )
}

function VerificationNotice() {
  const { snapshot } = useAuth()
  if (!snapshot) return null
  const deadline = new Date(snapshot.profile.verification_deadline_at)
  const verificationStatus = snapshot.identityVerificationStatus ?? 'not submitted'
  return (
    <section className="auth-feedback auth-warning" aria-label="Account verification status">
      <strong>Account access is restricted until identity verification is approved.</strong>
      <span>Verification: {verificationStatus}. Deadline: {Number.isNaN(deadline.getTime()) ? 'unavailable' : deadline.toLocaleString()}.</span>
      <a href="/passenger/profile-verification">View verification and support options</a>
    </section>
  )
}

function DriverApplication() {
  const { snapshot, applyForDriver } = useAuth()
  const [vehicleType, setVehicleType] = useState('')
  const [vehicleRegistrationNumber, setVehicleRegistrationNumber] = useState('')
  const [experienceYears, setExperienceYears] = useState('0')
  const [documents, setDocuments] = useState<Partial<Record<DriverDocumentType, File>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasAllDriverDocuments(documents)) {
      setError('Attach all five required documents before submitting.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await applyForDriver({
        vehicleType,
        vehicleRegistrationNumber,
        experienceYears: Number(experienceYears),
        documents,
      })
      setNotice('Your Driver application and documents were submitted for review. Your passenger account remains active.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The application could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  if (!snapshot) return <AccessMessage title="Sign in to apply" detail="Driver applications are attached to your existing passenger account." action={<a className="button button-primary" href="/login?next=%2Fdriver-application">Sign in <ArrowRight /></a>} />

  if (snapshot.driverApplicationStatus === 'approved') {
    return <AccessMessage title="Driver access is approved" detail="Your existing account already has an approved Driver role." action={<a className="button button-primary" href="/driver/overview">Open Driver workspace <ArrowRight /></a>} />
  }

  return (
    <main className="entry-page">
      <div className="entry-content">
        <p className="eyebrow">SAME-ACCOUNT DRIVER APPLICATION</p>
        <h1>Apply to drive with SureSeat</h1>
        <p className="entry-detail">Submit your vehicle details and required documents. Your existing passenger account remains active. Driver access is granted only after approval.</p>
        {snapshot.driverApplicationStatus === 'pending'
          ? <p className="auth-feedback auth-warning" role="status">Your application is pending administrator approval. Passenger access remains available.</p>
          : <>
              {snapshot.driverApplicationStatus === 'rejected' && <p className="auth-feedback auth-warning" role="status">Your previous application was rejected. Correct your details and submit a new application.</p>}
              {error && <p className="auth-feedback auth-error" role="alert">{error}</p>}
              {notice && <p className="auth-feedback auth-success" role="status">{notice}</p>}
              <form className="auth-form" onSubmit={(event) => void submit(event)}>
                <label className="field">Vehicle type
                  <input value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} maxLength={100} placeholder="e.g. Minibus, van" required />
                </label>
                <label className="field">Vehicle registration number
                  <input value={vehicleRegistrationNumber} onChange={(event) => setVehicleRegistrationNumber(event.target.value)} maxLength={30} placeholder="e.g. GR 1234-24" required />
                </label>
                <label className="field">Years of driving experience
                  <input type="number" value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} min="0" max="80" step="1" required />
                </label>
                <h2>Required documents</h2>
                <p className="entry-detail">Upload clear images or PDFs. Maximum 10 MB per document. Your documents are stored in private storage.</p>
                {requiredDriverDocuments.map(({ key, label, accept }) => (
                  <label className="field" key={key}>{label}
                    <input
                      type="file"
                      accept={accept}
                      required
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        setDocuments((current) => {
                          const next = { ...current }
                          if (file) next[key] = file
                          else delete next[key]
                          return next
                        })
                      }}
                    />
                    {documents[key] && <small>{documents[key].name}</small>}
                  </label>
                ))}
                <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Uploading documents…' : 'Submit Driver application'} <ArrowRight /></button>
              </form>
            </>}
        <a className="auth-back-link" href="/workspace">Back to workspace selection</a>
      </div>
    </main>
  )
}

function AuthFailure() {
  const { error, refresh } = useAuth()
  return <AccessMessage title="Account access could not be verified" detail={error || 'A required account or role check failed. Access is blocked until the issue is resolved.'} action={<button className="button button-secondary" onClick={() => void refresh().catch(() => undefined)}>Try again</button>} />
}

export default function AuthRouter() {
  const { mode, status, snapshot } = useAuth()
  const [pathname, setPathname] = useState(window.location.pathname)
  const query = new URLSearchParams(window.location.search)
  const safeReturnTo = getSafeReturnPath(query.get('next'))
  const resolvedAuthRoute = resolveAuthRoute(pathname)
  const requestedPortal = query.get('portal')
  const portal = resolvedAuthRoute?.kind === 'login' || resolvedAuthRoute?.kind === 'register'
    ? resolvedAuthRoute.portal
    : requestedPortal === 'driver' || requestedPortal === 'admin' || requestedPortal === 'passenger'
      ? requestedPortal
      : getPortalForWorkspacePath(safeReturnTo ?? '') ?? resolvedAuthRoute?.portal ?? 'passenger'
  const canOpenPortalAfterAuth = snapshot && canSignInToPortal(portal, snapshot)

  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  useEffect(() => {
    if (mode === 'supabase' && status === 'authenticated' && (
      pathname === '/auth/callback'
      || (canOpenPortalAfterAuth
        && (resolvedAuthRoute?.kind === 'login' || resolvedAuthRoute?.kind === 'register'))
    )) {
      const portalHome: Record<AuthPortal, string> = {
        passenger: '/passenger/home',
        driver: '/driver/overview',
        admin: '/admin/overview',
      }
      const portalPath = resolvedAuthRoute ? portalHome[portal] : null
      window.location.replace(portalPath && snapshot && canAccessWorkspacePath(portalPath, snapshot)
        ? portalPath
        : '/workspace')
    }
  }, [canOpenPortalAfterAuth, mode, pathname, portal, resolvedAuthRoute, snapshot, status])

  if (mode === 'invalid' || status === 'error') return <AuthFailure />
  if (mode === 'preview') {
    if (resolvedAuthRoute) return <AuthScreen kind="preview" portal={portal} />
    if (pathname === '/workspace') return <AccessMessage title="Preview workspace" detail="Preview mode has no authenticated roles. Use the existing passenger sample workspace to explore the current application." action={<a className="button button-primary" href="/passenger/home">Continue to preview <ArrowRight /></a>} />
    if (pathname === '/driver-application') return <AuthScreen kind="preview" />
    return <App />
  }

  if (status === 'loading') return <LoadingPage message="Checking account access" />
  if (resolvedAuthRoute) {
    return <AuthScreen kind={resolvedAuthRoute.kind as AuthScreenKind} returnTo={safeReturnTo} portal={portal} />
  }
  if (pathname === '/auth/callback') {
    return status === 'authenticated'
      ? <LoadingPage message="Opening your workspace" />
      : <AccessMessage title="Check your email" detail="If your email address is confirmed, return here after opening the confirmation link and sign in." action={<a className="button button-primary" href="/login">Sign in <ArrowRight /></a>} />
  }
  if (status === 'unauthenticated' && (pathname === '/workspace' || pathname.startsWith('/passenger/')
    || pathname.startsWith('/driver/') || pathname.startsWith('/admin/') || pathname === '/driver-application')) {
    const requested = `${pathname}${window.location.search}`
    return <AuthScreen kind="login" returnTo={requested} portal={getPortalForWorkspacePath(pathname) ?? 'passenger'} />
  }
  if (status === 'unauthenticated') return <App />
  if (!snapshot) return <AuthFailure />

  if (pathname === '/workspace') return <WorkspacePicker />
  if (pathname === '/driver-application') return <DriverApplication />

  if (pathname.startsWith('/passenger/') || pathname.startsWith('/driver/') || pathname.startsWith('/admin/')) {
    if (!canAccessWorkspacePath(pathname, snapshot)) {
      return <AccessMessage
        title="This workspace is not available"
        detail={snapshot.driverApplicationStatus === 'pending'
          ? 'Your Driver application is awaiting administrator approval. Passenger access remains available.'
          : 'Your signed-in account does not have the role or permission required for this area.'}
        action={<a className="button button-primary" href="/workspace">Choose an available workspace <ArrowRight /></a>}
      />
    }

    if (isAccountRestricted(snapshot.profile) && pathname === '/passenger/booking') {
      return <main className="entry-page"><div className="entry-content"><VerificationNotice /><h1>Bookings are unavailable</h1><p className="entry-detail">You can still sign in, review existing trips and subscriptions, submit identity documents, and contact support. Existing bookings and paid subscriptions are not removed.</p><a className="button button-primary" href="/passenger/profile-verification">View verification status <ArrowRight /></a></div></main>
    }
    return <App />
  }

  return <App />
}
