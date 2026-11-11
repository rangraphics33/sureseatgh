import { getPaystackSecret, getServiceClient, jsonResponse, verifyPaystackReference, verifyPaystackWebhook, applyVerifiedTransaction } from '../_shared/paystack.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' })
  try {
    const rawBody = new Uint8Array(await request.arrayBuffer())
    if (rawBody.length > 256_000) return jsonResponse(413, { error: 'Webhook payload too large.' })
    if (!await verifyPaystackWebhook(rawBody, request.headers)) return jsonResponse(401, { error: 'Invalid Paystack signature.' })
    const event = JSON.parse(new TextDecoder().decode(rawBody)) as {
      event?: string
      data?: { reference?: unknown }
    }
    if (event.event !== 'charge.success' || typeof event.data?.reference !== 'string') {
      return new Response(null, { status: 200 })
    }

    const service = getServiceClient()
    const reference = event.data.reference
    const { data: attempt, error } = await service.from('transport_payment_attempts')
      .select('provider_reference').eq('provider_reference', reference).maybeSingle()
    if (error) throw new Error('Could not load payment attempt.')
    if (!attempt) return new Response(null, { status: 200 })

    // Treat webhook data as a notification only. Independently verify the
    // transaction with Paystack before changing payment or booking status.
    const verified = await verifyPaystackReference(reference, getPaystackSecret())
    if (!verified.found || !verified.transaction || verified.providerStatus !== 'success') {
      return jsonResponse(503, { error: 'Paystack transaction verification is temporarily unavailable.' })
    }
    await applyVerifiedTransaction(service, reference, verified.transaction, true)
    return new Response(null, { status: 200 })
  } catch (error) {
    console.error('paystack-transport-webhook failed', error instanceof Error ? error.message : 'unknown error')
    return jsonResponse(503, { error: 'Webhook processing failed; Paystack may retry this event.' })
  }
})
