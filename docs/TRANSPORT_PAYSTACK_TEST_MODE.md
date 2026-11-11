# Transport booking payments — Paystack test mode

The transport payment flow is server-owned. The browser requests checkout for its own booking, redirects to Paystack's hosted checkout, and can ask the server to check status when it returns. It cannot set a payment result.

## Duplicate-payment controls

- `transport_payment_attempts` has one row per booking and one globally unique Paystack reference. Retrying the same booking reuses the attempt and hosted checkout URL.
- The initializer verifies an existing provider reference before returning checkout again. It does not mint another reference for an existing booking.
- The Paystack transaction reference is unique at the provider. If a network timeout makes initialization ambiguous, retries probe that same reference; they do not create a second transaction.
- Webhook retries and browser callbacks both use the same locked, idempotent database confirmation function. The provider transaction ID is unique in the database.
- The server checks reference, test domain, GHS currency, and the server-stored amount in pesewas before confirming.
- If the provider reports success after the booking hold expires, the payment becomes `succeeded_unapplied`; it does not take a seat. Support/refund handling is still required for that exceptional case.
- A failed attempt is not retried under a new reference for the same booking. The current safety tradeoff is to block another charge on that booking; after the hold expires, the passenger can create a new booking.

No payment system can promise that a bank or provider will never show a duplicate authorization, delayed reversal, or disputed charge. These controls prevent SureSeat from creating multiple Paystack transactions for the same booking reference and prevent repeated webhooks from confirming more than once. Reconciliation and refunds still need operational handling.

## Deployment setup

1. Apply `supabase/migrations/20261111150000_transport_paystack_payments.sql` to the intended Supabase project after reviewing it. This repository change does not apply it to the hosted database.
2. Set Supabase Function secrets from your Paystack **test** integration and the deployed app URL. Never put these values in `VITE_*`, source control, or chat:
   - `PAYSTACK_SECRET_KEY` (`sk_test_...`)
   - `PAYSTACK_WEBHOOK_SECRET` (`whsec_...` from the Paystack dashboard)
   - `APP_BASE_URL` (the app's HTTPS origin)
3. Deploy `initialize-transport-payment`, `verify-transport-payment`, and `paystack-transport-webhook` Edge Functions.
4. Configure the Paystack **test-mode** webhook URL to the deployed `paystack-transport-webhook` function. Test signature rejection, a valid payment, a repeated webhook, mismatched amount/currency, and payment after hold expiry before enabling booking checkout for users.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are read only by the Edge runtime. The service-role key must remain in Supabase's function environment.

## Known deployment limits

- The payment attempt schema and functions are not live until the new migration is applied.
- The Edge Functions are not live until deployed and the secrets are configured.
- If Paystack creates a transaction but both the checkout URL write and the original response are lost, the unique reference still prevents another charge, but support may need to reconcile that checkout manually.
- `succeeded_unapplied` and `review_required` need a staffed support/refund process; no automatic refund is issued.
- This phase handles transport booking payments only. Subscription checkout and production/live Paystack credentials remain out of scope.
