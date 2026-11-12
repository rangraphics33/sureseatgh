import { createContext, useContext } from 'react'
import type { AuthSnapshot, DriverApplicationInput } from '../../services/auth.ts'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error' | 'preview'
export type AuthMode = 'preview' | 'supabase' | 'invalid'

export interface AuthContextValue {
  mode: AuthMode
  status: AuthStatus
  snapshot: AuthSnapshot | null
  error: string
  refresh: () => Promise<AuthSnapshot | null>
  signIn: (email: string, password: string) => Promise<AuthSnapshot>
  signUp: (email: string, password: string, fullName: string, returnTo?: string | null) => Promise<AuthSnapshot | null>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  updateOwnProfile: (input: { fullName: string; phone: string }) => Promise<void>
  applyForDriver: (input: DriverApplicationInput) => Promise<void>
  submitIdentityVerification: (file: File) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider.')
  return context
}
