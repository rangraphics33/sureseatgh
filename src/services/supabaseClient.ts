import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfiguration {
  url: string
  publishableKey: string
}

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseConfigurationError'
  }
}

function getLegacyJwtRole(key: string) {
  const segments = key.split('.')
  if (segments.length !== 3) return null

  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(payload)) as { role?: unknown }
    return typeof decoded.role === 'string' ? decoded.role : null
  } catch {
    return null
  }
}

function isServerKey(key: string) {
  return /^sb_secret_/i.test(key) || getLegacyJwtRole(key) === 'service_role'
}

export function resolveSupabaseConfiguration(
  urlValue: string | undefined,
  keyValue: string | undefined,
): SupabaseConfiguration {
  const url = urlValue?.trim()
  const publishableKey = keyValue?.trim()
  if (!url || !publishableKey) {
    const missing = [
      !url && 'VITE_SUPABASE_URL',
      !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean).join(' and ')
    throw new SupabaseConfigurationError(
      `Supabase is not configured. Set ${missing} in the local environment before enabling Supabase features.`,
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL must be an absolute HTTPS URL.')
  }

  const isLocalHttp = parsedUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if ((parsedUrl.protocol !== 'https:' && !isLocalHttp)
    || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new SupabaseConfigurationError(
      'VITE_SUPABASE_URL must be an HTTPS URL (HTTP is allowed only for a local Supabase instance), without credentials, query, or hash.',
    )
  }

  if (isServerKey(publishableKey)) {
    throw new SupabaseConfigurationError(
      'VITE_SUPABASE_PUBLISHABLE_KEY contains a server-only secret/service-role key. Use a publishable or legacy anon key; never put server keys in Vite environment variables.',
    )
  }
  if (!/^sb_publishable_/i.test(publishableKey) && getLegacyJwtRole(publishableKey) !== 'anon') {
    throw new SupabaseConfigurationError(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key or legacy anon key.',
    )
  }

  return { url: parsedUrl.toString().replace(/\/+$/, ''), publishableKey }
}

export const supabaseConfigurationError = (() => {
  try {
    resolveSupabaseConfiguration(
      import.meta.env?.VITE_SUPABASE_URL,
      import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY,
    )
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Supabase configuration is invalid.'
  }
})()

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (client) return client

  const { url, publishableKey } = resolveSupabaseConfiguration(
    import.meta.env?.VITE_SUPABASE_URL,
    import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY,
  )
  client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}
