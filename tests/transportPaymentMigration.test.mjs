import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20261111150000_transport_paystack_payments.sql', import.meta.url), 'utf8')
const initializer = await readFile(new URL('../supabase/functions/initialize-transport-payment/index.ts', import.meta.url), 'utf8')
const verifier = await readFile(new URL('../supabase/functions/verify-transport-payment/index.ts', import.meta.url), 'utf8')
const webhook = await readFile(new URL('../supabase/functions/paystack-transport-webhook/index.ts', import.meta.url), 'utf8')
const shared = await readFile(new URL('../supabase/functions/_shared/paystack.ts', import.meta.url), 'utf8')

test('payment attempts are unique per booking and provider reference with no client table access', () => {
  assert.match(migration, /booking_id uuid not null unique/)
  assert.match(migration, /provider_reference text not null unique/)
  assert.match(migration, /revoke all on public\.transport_payment_attempts from public, anon, authenticated/)
})

test('only trusted service-role RPCs can reserve and confirm booking payments', () => {
  assert.match(migration, /auth\.role\(\) <> 'service_role'/)
  assert.match(migration, /grant execute on function public\.confirm_transport_booking_payment\([^;]+ to service_role/s)
  assert.match(migration, /revoke all on function public\.confirm_transport_booking_payment\([^;]+ from public, anon, authenticated/s)
})

test('payment confirmation checks stored amount, GHS currency, test domain and active hold', () => {
  assert.match(migration, /p_amount_minor = v_attempt\.amount_minor/)
  assert.match(migration, /upper\(coalesce\(p_currency, ''\)\) = v_attempt\.currency/)
  assert.match(migration, /p_provider_domain = 'test'/)
  assert.match(migration, /v_booking\.hold_expires_at > v_now/)
  assert.match(migration, /succeeded_unapplied/)
})

test('initialization retries reuse a reference and never accept a browser payment result', () => {
  assert.match(initializer, /reserve_transport_booking_payment/)
  assert.match(initializer, /verifyPaystackReference/)
  assert.match(initializer, /reference: attempt\.provider_reference/)
  assert.doesNotMatch(initializer, /p_provider_says_success/)
})

test('callback and webhook independently verify Paystack before database confirmation', () => {
  assert.match(verifier, /verifyPaystackReference/)
  assert.match(webhook, /verifyPaystackWebhook/)
  assert.match(webhook, /verifyPaystackReference/)
  assert.match(webhook, /applyVerifiedTransaction/)
  assert.match(shared, /Math\.abs\(Date\.now\(\) \/ 1000 - seconds\) > 300/)
  assert.match(shared, /p_amount_minor: Number\.isSafeInteger\(transaction\.amount\)/)
})
