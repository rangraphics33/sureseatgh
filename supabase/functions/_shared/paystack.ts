import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new Error('Supabase payment service is not configured.')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function getPaystackSecret(): string {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''
  if (!key.startsWith('sk_test_')) throw new Error('Paystack test mode is not configured.')
  return key
}

export async function verifyPaystackReference(reference: string, secret: string) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  const payload = await response.json().catch(() => null) as {
    status?: boolean
    message?: string
    data?: {
      id?: number | string
      status?: string
      reference?: string
      amount?: number
      currency?: string
      domain?: string
    }
  } | null
  if (!response.ok || !payload?.status || !payload.data) {
    return { found: false as const, providerStatus: null, transaction: null }
  }
  return { found: true as const, providerStatus: payload.data.status ?? null, transaction: payload.data }
}

export async function applyVerifiedTransaction(
  service: SupabaseClient,
  reference: string,
  transaction: NonNullable<Awaited<ReturnType<typeof verifyPaystackReference>>['transaction']>,
  providerSaysSuccess: boolean,
) {
  if (transaction.reference !== reference) throw new Error('Paystack returned a mismatched payment reference.')
  const { data, error } = await service.rpc('confirm_transport_booking_payment', {
    p_provider_reference: reference,
    p_provider_transaction_id: String(transaction.id ?? ''),
    p_amount_minor: Number.isSafeInteger(transaction.amount) ? transaction.amount : -1,
    p_currency: transaction.currency ?? '',
    p_provider_domain: transaction.domain ?? '',
    p_provider_says_success: providerSaysSuccess,
  })
  if (error) throw new Error(`Could not update verified booking payment: ${error.message}`)
  const result = Array.isArray(data) ? data[0] : data
  return result as { payment_status: string; booking_status: string } | null
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i]
  return mismatch === 0
}

function fromHex(hex: string) {
  if (!/^[0-9a-f]{128}$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

async function hmacSha512(secret: string, message: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
}

export async function verifyPaystackWebhook(rawBody: Uint8Array, headers: Headers) {
  const currentHeader = headers.get('paystack-signature')
  const signingSecret = Deno.env.get('PAYSTACK_WEBHOOK_SECRET')
  if (currentHeader && signingSecret?.startsWith('whsec_')) {
    const entries = currentHeader.split(',').map((part) => part.trim())
    const timestamp = entries.find((part) => part.startsWith('t='))?.slice(2)
    const versions = entries.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3))
    const seconds = Number(timestamp)
    if (!/^[0-9]{1,12}$/.test(timestamp ?? '') || !Number.isFinite(seconds)
      || Math.abs(Date.now() / 1000 - seconds) > 300 || versions.length === 0) return false
    const prefix = new TextEncoder().encode(`${timestamp}.`)
    const signed = new Uint8Array(prefix.length + rawBody.length)
    signed.set(prefix)
    signed.set(rawBody, prefix.length)
    const expected = await hmacSha512(signingSecret, signed)
    return versions.some((version) => {
      const separator = version.indexOf(':')
      const supplied = fromHex(separator >= 0 ? version.slice(separator + 1) : '')
      return supplied !== null && constantTimeEqual(expected, supplied)
    })
  }

  const legacyHeader = headers.get('x-paystack-signature')
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (legacyHeader && secretKey) {
    const expected = await hmacSha512(secretKey, rawBody)
    const supplied = fromHex(legacyHeader)
    return supplied !== null && constantTimeEqual(expected, supplied)
  }
  return false
}
