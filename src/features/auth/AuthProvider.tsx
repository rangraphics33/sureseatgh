import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getSupabaseClient } from '../../services/supabaseClient.ts'
import { sureSeatAuth } from '../../services/auth.ts'
import type { AuthSnapshot, DriverApplicationInput } from '../../services/auth.ts'
import { resolveAuthMode } from './access.ts'
import { AuthContext } from './authContext.ts'
import type { AuthContextValue, AuthStatus } from './authContext.ts'

const authMode = resolveAuthMode(import.meta.env.VITE_AUTH_MODE)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    authMode === 'preview' ? 'preview' : authMode === 'invalid' ? 'error' : 'loading',
  )
  const [snapshot, setSnapshot] = useState<AuthSnapshot | null>(null)
  const [error, setError] = useState(authMode === 'invalid'
    ? 'VITE_AUTH_MODE must be "preview" or "supabase".'
    : '')
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    if (authMode !== 'supabase') {
      setSnapshot(null)
      setStatus(authMode === 'preview' ? 'preview' : 'error')
      setError(authMode === 'invalid'
        ? 'VITE_AUTH_MODE must be "preview" or "supabase".'
        : '')
      return null
    }

    const currentRequestId = ++requestId.current
    setStatus('loading')
    setError('')
    try {
      const current = await sureSeatAuth.getCurrentState()
      if (currentRequestId === requestId.current) {
        setSnapshot(current)
        setStatus(current ? 'authenticated' : 'unauthenticated')
      }
      return current
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not verify the current account.'
      if (currentRequestId === requestId.current) {
        setSnapshot(null)
        setStatus('error')
        setError(message)
      }
      throw loadError
    }
  }, [])

  useEffect(() => {
    if (authMode === 'preview') return
    if (authMode === 'invalid') return

    let active = true
    let refreshTimer = 0
    let subscription: ReturnType<ReturnType<typeof getSupabaseClient>['auth']['onAuthStateChange']>['data']['subscription'] | undefined

    try {
      const client = getSupabaseClient()
      const authListener = client.auth.onAuthStateChange((event) => {
        if (!active) return
        if (event === 'SIGNED_OUT') {
          requestId.current += 1
          setSnapshot(null)
          setError('')
          setStatus('unauthenticated')
          return
        }
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => {
          if (active) void refresh().catch(() => undefined)
        }, 0)
      })
      subscription = authListener.data.subscription
      refreshTimer = window.setTimeout(() => {
        if (active) void refresh().catch(() => undefined)
      }, 0)
    } catch (setupError) {
      refreshTimer = window.setTimeout(() => {
        if (active) {
          setStatus('error')
          setError(setupError instanceof Error ? setupError.message : 'Supabase is not configured.')
        }
      }, 0)
    }

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
      subscription?.unsubscribe()
    }
  }, [refresh])

  const value = useMemo<AuthContextValue>(() => ({
    mode: authMode,
    status,
    snapshot,
    error,
    refresh,
    async signIn(email, password) {
      if (authMode !== 'supabase') throw new Error('Sign-in is available only in Supabase authentication mode.')
      await sureSeatAuth.signIn(email, password)
      const current = await refresh()
      if (!current) throw new Error('Supabase did not return an authenticated account.')
      return current
    },
    async signUp(email, password, fullName) {
      if (authMode !== 'supabase') throw new Error('Registration is available only in Supabase authentication mode.')
      const result = await sureSeatAuth.signUp(email, password, fullName)
      if (result.session) await refresh()
      return Boolean(result.session)
    },
    async signOut() {
      await sureSeatAuth.signOut()
      requestId.current += 1
      setSnapshot(null)
      setError('')
      setStatus(authMode === 'preview' ? 'preview' : 'unauthenticated')
    },
    requestPasswordReset: (email) => sureSeatAuth.requestPasswordReset(email),
    updatePassword: (password) => sureSeatAuth.updatePassword(password),
    async applyForDriver(input: DriverApplicationInput) {
      await sureSeatAuth.submitDriverApplication(input)
      await refresh()
    },
    async submitIdentityVerification(file) {
      await sureSeatAuth.submitIdentityVerification(file)
      await refresh()
    },
  }), [error, refresh, snapshot, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
