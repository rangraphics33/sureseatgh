import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveSupabaseConfiguration,
  SupabaseConfigurationError,
} from '../src/services/supabaseClient.ts'

test('Supabase configuration normalizes the URL and preserves the publishable key', () => {
  assert.deepEqual(
    resolveSupabaseConfiguration(' https://example.supabase.co/ ', ' sb_publishable_test '),
    { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' },
  )
})

test('Supabase configuration reports each missing environment variable', () => {
  assert.throws(
    () => resolveSupabaseConfiguration(undefined, undefined),
    (error) => error instanceof SupabaseConfigurationError
      && error.message.includes('VITE_SUPABASE_URL')
      && error.message.includes('VITE_SUPABASE_PUBLISHABLE_KEY'),
  )
})

test('Supabase configuration rejects non-HTTPS production URLs', () => {
  assert.throws(
    () => resolveSupabaseConfiguration('http://example.supabase.co', 'sb_publishable_test'),
    SupabaseConfigurationError,
  )
  assert.doesNotThrow(
    () => resolveSupabaseConfiguration('http://localhost:54321', 'sb_publishable_test'),
  )
})

test('Supabase configuration rejects known server-only key formats', () => {
  assert.throws(
    () => resolveSupabaseConfiguration('https://example.supabase.co', 'sb_secret_do_not_use'),
    /server-only secret\/service-role key/,
  )
  const payload = btoa(JSON.stringify({ role: 'service_role' }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  assert.throws(
    () => resolveSupabaseConfiguration('https://example.supabase.co', `header.${payload}.signature`),
    /server-only secret\/service-role key/,
  )
})

test('Supabase configuration rejects unknown key formats', () => {
  assert.throws(
    () => resolveSupabaseConfiguration('https://example.supabase.co', 'not-a-supabase-key'),
    /must be a Supabase publishable key or legacy anon key/,
  )
})
