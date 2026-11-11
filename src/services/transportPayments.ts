import { getSupabaseClient } from './supabaseClient.ts'

interface InitializePaymentResponse {
  authorizationUrl?: string
  reference?: string
  status?: string
  error?: string
}

interface VerifyPaymentResponse {
  status: 'not_started' | 'initializing' | 'checkout_ready' | 'succeeded' | 'failed' | 'succeeded_unapplied' | 'review_required' | 'pending'
  bookingStatus: string
  error?: string
}

function throwFunctionError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

export const transportPaymentService = {
  async initialize(bookingId: string) {
    const { data, error } = await getSupabaseClient().functions.invoke<InitializePaymentResponse>(
      'initialize-transport-payment', { body: { bookingId } },
    )
    throwFunctionError(error, 'Could not start Paystack checkout')
    if (data?.error) throw new Error(data.error)
    return data
  },

  async verify(input: { bookingId?: string; reference?: string }) {
    const { data, error } = await getSupabaseClient().functions.invoke<VerifyPaymentResponse>(
      'verify-transport-payment', { body: input },
    )
    throwFunctionError(error, 'Could not verify payment')
    if (data?.error) throw new Error(data.error)
    if (!data?.status) throw new Error('The payment service returned no verification result.')
    return data
  },
}
