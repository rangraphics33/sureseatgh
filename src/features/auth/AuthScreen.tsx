import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Moon, ShieldCheck, Sun } from 'lucide-react'
import { canAccessWorkspacePath, canSignInToPortal, getSafeReturnPath, getWorkspaceOptions } from './access.ts'
import type { AuthPortal } from './access.ts'
import { useAuth } from './authContext.ts'

export type AuthScreenKind = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'preview'

function getPostAuthPath(
  nextValue: string | null,
  roles: Parameters<typeof getWorkspaceOptions>[0],
  portal: AuthPortal,
) {
  const requested = getSafeReturnPath(nextValue)
  if (requested === '/driver-application' && portal === 'passenger' && roles.roles.includes('passenger')) return requested
  if (requested?.startsWith(`/${portal}/`)
    && canAccessWorkspacePath(requested, roles)) return requested
  const portalStart = portal === 'passenger'
    ? '/passenger/home'
    : portal === 'driver' ? '/driver/overview' : '/admin/overview'
  if (canAccessWorkspacePath(portalStart, roles)) return portalStart
  const workspaces = getWorkspaceOptions(roles)
  if (workspaces.length === 1) {
    return workspaces[0] === 'Passenger'
      ? '/passenger/home'
      : workspaces[0] === 'Driver' ? '/driver/overview' : '/admin/overview'
  }
  return '/workspace'
}

export default function AuthScreen({
  kind,
  returnTo,
  portal = 'passenger',
}: {
  kind: AuthScreenKind
  returnTo?: string | null
  portal?: AuthPortal
}) {
  const { mode, signIn, signUp, requestPasswordReset, updatePassword } = useAuth()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('sureseat-theme') === 'dark' ? 'dark' : 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('sureseat-theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((current) => current === 'light' ? 'dark' : 'light')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (kind === 'login') {
        const snapshot = await signIn(email, password)
        if (!canSignInToPortal(portal, snapshot)) {
          throw new Error(portal === 'driver'
            ? 'This account does not have approved Driver access yet. Apply using your passenger account.'
            : portal === 'admin'
              ? 'This account is not authorized for the administration portal.'
              : 'This account does not have Passenger access.')
        }
        window.location.assign(getPostAuthPath(returnTo ?? null, snapshot, portal))
      } else if (kind === 'register') {
        const hasSession = await signUp(email, password, fullName)
        if (hasSession) {
          window.location.assign('/workspace')
        } else {
          setNotice('Account created. Check your email to confirm the address, then sign in.')
        }
      } else if (kind === 'forgot-password') {
        await requestPasswordReset(email)
        setNotice('If an account exists for that email, a password reset link will be sent.')
      } else if (kind === 'reset-password') {
        if (password !== confirmPassword) {
          setError('The passwords do not match.')
          return
        }
        await updatePassword(password)
        setNotice('Your password has been updated. You can continue to your workspace.')
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const isRegister = kind === 'register'
  const isForgot = kind === 'forgot-password'
  const isReset = kind === 'reset-password'
  const title = isRegister ? 'Create your passenger account'
    : isForgot ? 'Reset your password'
      : isReset ? 'Choose a new password' : 'Welcome back'
  const returnQuery = returnTo ? `?next=${encodeURIComponent(returnTo)}` : ''
  const forgotQuery = `?${[
    returnTo ? `next=${encodeURIComponent(returnTo)}` : '',
    `portal=${portal}`,
  ].filter(Boolean).join('&')}`
  const loginPath = `/${portal}/login${returnQuery}`

  if (kind === 'preview' || mode === 'preview') {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-top-actions"><button className="icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon /> : <Sun />}</button></div>
          <a className="entry-brand" href="/" aria-label="SureSeat home">
            <span className="brand-mark">S</span>
            <span>Sure<span className="brand-gold">Seat</span></span>
          </a>
          <span className="auth-icon"><ShieldCheck /></span>
          <p className="eyebrow">{portal.toUpperCase()} PORTAL</p>
          <h1 id="auth-title">Authentication is off in preview mode</h1>
          <p className="entry-detail">Preview mode is explicitly selected. Continue to the existing sample workspace, or set <code>VITE_AUTH_MODE=supabase</code> to use Supabase authentication.</p>
          <a className="button button-primary auth-submit" href="/passenger/home">Continue to preview <ArrowRight /></a>
          <a className="auth-back-link" href="/">Back to SureSeat home</a>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-top-actions"><button className="icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon /> : <Sun />}</button></div>
        <a className="entry-brand" href="/" aria-label="SureSeat home">
          <span className="brand-mark">S</span>
          <span>Sure<span className="brand-gold">Seat</span></span>
        </a>
        <span className="auth-icon"><ShieldCheck /></span>
        <p className="eyebrow">{portal.toUpperCase()} PORTAL</p>
        <h1 id="auth-title">{portal === 'admin' && kind === 'login'
          ? 'Administrator sign in'
          : portal === 'driver' && kind === 'login' ? 'Driver sign in' : title}</h1>
        <p className="entry-detail">
          {isRegister
            ? 'Create one account for passenger journeys. You can apply for an approved Driver role later.'
            : isForgot
              ? 'Enter your email and we will send a reset link if the account is registered.'
              : isReset
                ? 'Use a strong password that you have not used elsewhere.'
                : 'Sign in to continue to your authorized SureSeat workspace.'}
        </p>

        {error && <p className="auth-feedback auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-feedback auth-success" role="status">{notice}</p>}

        {!notice || (!isRegister && !isForgot && !isReset) ? (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {isRegister && (
              <label className="field">Full name
                <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} />
              </label>
            )}
            {!isReset && (
              <label className="field">Email address
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
            )}
            {!isForgot && (
              <div className="field">
                <label htmlFor="auth-password">{isReset ? 'New password' : 'Password'}</label>
                <span className="password-input-wrap">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isRegister ? 'new-password' : isReset ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    required
                  />
                  <button className="password-visibility" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </div>
            )}
            {isReset && (
              <div className="field">
                <label htmlFor="confirm-password">Confirm new password</label>
                <span className="password-input-wrap">
                  <input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required />
                  <button className="password-visibility" type="button" aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)}>
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </div>
            )}
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : isRegister ? 'Create account' : isForgot ? 'Send reset link' : isReset ? 'Update password' : 'Sign in'}
              {!busy && <ArrowRight />}
            </button>
          </form>
        ) : null}

        <nav className="auth-links" aria-label="Account options">
          {kind === 'login' && <><a href={`/forgot-password${forgotQuery}`}>Forgot password?</a>{portal === 'passenger' && <><span>·</span><a href={`/passenger/register${returnQuery}`}>Create account</a></>}</>}
          {kind === 'register' && <><span>Already registered?</span><a href={loginPath}>Sign in</a></>}
          {(isForgot || isReset) && <a href={loginPath}>Back to sign in</a>}
        </nav>
        <a className="auth-back-link" href="/">Back to SureSeat home</a>
      </section>
    </main>
  )
}
