import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const authScreen = readFileSync(new URL('../src/features/auth/AuthScreen.tsx', import.meta.url), 'utf8')
const authRouter = readFileSync(new URL('../src/features/auth/AuthRouter.tsx', import.meta.url), 'utf8')
const authService = readFileSync(new URL('../src/services/auth.ts', import.meta.url), 'utf8')

test('driver sign-in provides the passenger-account creation and application route', () => {
  assert.match(authScreen, /New driver\? Create account & apply/)
  assert.match(authScreen, /\/passenger\/register\?next=%2Fdriver-application/)
  assert.match(authScreen, /signUp\(email, password, fullName, returnTo\)/)
})

test('driver application return path survives Supabase email confirmation', () => {
  assert.match(authService, /auth\/callback\$\{safeReturnTo \? `\?next=/)
  assert.match(authRouter, /pathname === '\/auth\/callback'/)
  assert.match(authRouter, /requested === '\/driver-application'/)
  assert.match(authRouter, /snapshot\.roles\.includes\('passenger'\)/)
})
