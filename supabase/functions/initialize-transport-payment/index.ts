import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, getPaystackSecret, getServiceClient, jsonResponse, verifyPaystackReference, applyVerifiedTransaction } from '../_shared/paystack.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' })

  try {
    const authorization = request.headers.get('Authorization')
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!token || !url || !anonKey) return jsonResponse(401, { error: 'Sign in to start payment.' })

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userResult, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userResult.user) return jsonResponse(401, { error: 'Your session has expired. Sign in again.' })

    const body = await request.json().catch(() => null) as { bookingId?: unknown } | null
    if (typeof body?.bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.bookingId)) {
      return jsonResponse(400, { error: 'A valid booking is required.' })
    }
    const baseUrl = Deno.env.get('APP_BASE_URL')
    if (!baseUrl) return jsonResponse(503, { error: 'Payment return URL is not configured.' })
    const callbackUrl = new URL('/passenger/my-trips', baseUrl)
    callbackUrl.searchParams.set('payment', 'return')

    const service = getServiceClient()
    const reference = `SS-${crypto.randomUUID()}`
    const { data: reservation, error: reserveError } = await service.rpc('reserve_transport_booking_payment', {
      p_passenger_user_id: userResult.user.id,
      p_booking_id: body.bookingId,
      p_provider_reference: reference,
    })
    if (reserveError) return jsonResponse(409, { error: reserveError.message })
    const attempt = Array.isArray(reservation) ? reservation[0] : reservation
    if (!attempt?.provider_reference) return jsonResponse(503, { error: 'Payment attempt could not be prepared.' })

    const secret = getPaystackSecret()
    if (attempt.authorization_url) {
      const existing = await verifyPaystackReference(attempt.provider_reference, secret)
      if (existing.found && existing.transaction) {
        if (existing.providerStatus === 'success') {
          const result = await applyVerifiedTransaction(service, attempt.provider_reference, existing.transaction, true)
          return jsonResponse(200, { status: result?.payment_status ?? 'succeeded', reference: attempt.provider_reference })
        }
        if (['failed', 'abandoned', 'reversed'].includes(existing.providerStatus ?? '')) {
          const { error: failError } = await service.rpc('fail_transport_payment_attempt', {
            p_provider_reference: attempt.provider_reference,
            p_failure_code: `provider_${existing.providerStatus}`,
          })
          if (failError) throw new Error('Could not persist the provider failure status.')
          return jsonResponse(200, { status: 'failed', reference: attempt.provider_reference })
        }
      }
      return jsonResponse(200, { authorizationUrl: attempt.authorization_url, reference: attempt.provider_reference })
    }

    // If the Edge Function is retried after an ambiguous network result, check
    // the same unique reference before any new initialize call.
    const prior = await verifyPaystackReference(attempt.provider_reference, secret)
    if (prior.found && prior.transaction) {
      if (['failed', 'abandoned', 'reversed'].includes(prior.providerStatus ?? '')) {
        const { error: failError } = await service.rpc('fail_transport_payment_attempt', {
          p_provider_reference: attempt.provider_reference,
          p_failure_code: `provider_${prior.providerStatus}`,
        })
        if (failError) throw new Error('Could not persist the provider failure status.')
        return jsonResponse(200, { status: 'failed', reference: attempt.provider_reference })
      }
      const result = await applyVerifiedTransaction(service, attempt.provider_reference, prior.transaction, prior.providerStatus === 'success')
      return jsonResponse(200, { status: result?.payment_status ?? 'pending', reference: attempt.provider_reference })
    }

    const amountMinor = Number(attempt.amount_minor)
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || attempt.currency !== 'GHS') {
      return jsonResponse(409, { error: 'The saved booking amount is invalid. Contact support before paying.' })
    }
    const providerResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: userResult.user.email,
        amount: String(amountMinor),
        currency: attempt.currency,
        reference: attempt.provider_reference,
        callback_url: callbackUrl.toString(),
        metadata: { booking_id: body.bookingId, source: 'sureseat_transport' },
      }),
      signal: AbortSignal.timeout(12_000),
    })
    const providerPayload = await providerResponse.json().catch(() => null) as {
      status?: boolean
      data?: { authorization_url?: string; reference?: string }
    } | null
    if (!providerResponse.ok || !providerPayload?.status || !providerPayload.data?.authorization_url
      || providerPayload.data.reference !== attempt.provider_reference) {
      // Do not generate a new reference here. The attempt is retained so any
      // later retry checks/reuses the same Paystack reference and cannot double-charge.
      return jsonResponse(502, { error: 'Checkout setup could not be confirmed. Retry once in a moment or contact support; do not create another payment.' })
    }

    const { error: saveError } = await service.rpc('set_transport_payment_checkout', {
      p_provider_reference: attempt.provider_reference,
      p_authorization_url: providerPayload.data.authorization_url,
    })
    if (saveError) {
      console.error('Could not persist Paystack checkout URL', saveError.message)
      // The unique attempt/reference was already reserved. Returning the hosted
      // URL lets this in-flight request finish; later retries still cannot create
      // a second transaction for this booking.
      return jsonResponse(200, {
        authorizationUrl: providerPayload.data.authorization_url,
        reference: attempt.provider_reference,
        warning: 'Checkout URL persistence failed; verify status from My Trips after returning.',
      })
    }
    return jsonResponse(200, { authorizationUrl: providerPayload.data.authorization_url, reference: attempt.provider_reference })
  } catch (error) {
    console.error('initialize-transport-payment failed', error instanceof Error ? error.message : 'unknown error')
    return jsonResponse(503, { error: 'Payment service is temporarily unavailable. Your booking remains unconfirmed.' })
  }
})
