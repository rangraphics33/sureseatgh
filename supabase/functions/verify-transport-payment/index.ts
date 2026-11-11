import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, getPaystackSecret, getServiceClient, jsonResponse, verifyPaystackReference, applyVerifiedTransaction } from '../_shared/paystack.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' })
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!token || !url || !anonKey) return jsonResponse(401, { error: 'Sign in to verify payment.' })
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userResult, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userResult.user) return jsonResponse(401, { error: 'Your session has expired. Sign in again.' })
    const body = await request.json().catch(() => null) as { reference?: unknown; bookingId?: unknown } | null
    const hasReference = typeof body?.reference === 'string' && /^SS-[A-Za-z0-9-]{20,80}$/.test(body.reference)
    const hasBookingId = typeof body?.bookingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.bookingId)
    if (!hasReference && !hasBookingId) {
      return jsonResponse(400, { error: 'Payment reference is invalid.' })
    }

    const service = getServiceClient()
    let query = service.from('transport_payment_attempts')
      .select('provider_reference')
      .eq('passenger_user_id', userResult.user.id)
    query = hasReference ? query.eq('provider_reference', body!.reference as string)
      : query.eq('booking_id', body!.bookingId as string)
    const { data: attempt, error: attemptError } = await query.maybeSingle()
    if (attemptError) throw new Error('Could not load payment attempt.')
    if (!attempt) return jsonResponse(200, { status: 'not_started', bookingStatus: 'pending_payment' })

    const verified = await verifyPaystackReference(attempt.provider_reference, getPaystackSecret())
    if (!verified.found || !verified.transaction) return jsonResponse(200, { status: 'pending', bookingStatus: 'pending_payment' })
    if (['failed', 'abandoned', 'reversed'].includes(verified.providerStatus ?? '')) {
      const { error: failError } = await service.rpc('fail_transport_payment_attempt', {
        p_provider_reference: attempt.provider_reference,
        p_failure_code: `provider_${verified.providerStatus}`,
      })
      if (failError) throw new Error('Could not persist the provider failure status.')
      return jsonResponse(200, { status: 'failed', bookingStatus: 'pending_payment' })
    }
    const result = await applyVerifiedTransaction(service, attempt.provider_reference, verified.transaction, verified.providerStatus === 'success')
    return jsonResponse(200, {
      status: result?.payment_status ?? 'pending',
      bookingStatus: result?.booking_status ?? 'pending_payment',
    })
  } catch (error) {
    console.error('verify-transport-payment failed', error instanceof Error ? error.message : 'unknown error')
    return jsonResponse(503, { error: 'Payment status could not be verified. Your booking remains unconfirmed until the server confirms it.' })
  }
})
