# Supabase foundation setup

## What this setup does

- Adds the official `@supabase/supabase-js` SDK and a lazy, configuration-validated client helper.
- Keeps the existing preview/API service selection unchanged; no feature creates a Supabase client or changes modes automatically.
- Adds a database migration for identity, roles, staff permissions, invitations, verification, audit records, RLS, and private document buckets.
- Adds a restricted-user support-request table path; the existing preview support form is not connected to it.
- Adds SQL security tests for the Supabase local test runner.

The migration has **not** been applied to the hosted Supabase project. Do not treat the hosted project as configured until the migration is applied and verified.

## Local frontend configuration

Copy the ignored root `.env.local` example values into your local environment as needed. The supplied development configuration uses the project's URL and publishable key. `.env.local` is ignored by Git. Vite variables are public; only a publishable or legacy anon key belongs in the browser. Never use a `service_role`, `sb_secret_*`, database password, or payment secret in a `VITE_` variable.

The Supabase helper is lazy. It reports a clear configuration error from `getSupabaseClient()` if the URL/key is absent or invalid; importing it does not affect preview mode. No Supabase auth flow is connected to the app yet.

## Apply locally

Prerequisites: install the Supabase CLI and Docker Desktop, then from the project root:

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
```

`db reset` applies local migrations and resets local data. Do not run it against a hosted project.

## Apply to the hosted project

1. Confirm the target Supabase project and take an appropriate database backup.
2. Review `supabase/migrations/20261109150000_auth_access_foundation.sql` and run the local migration/test workflow first.
3. Link the Supabase CLI to the intended project using an interactive/local CLI session; do not commit an access token.
4. Review the migration diff, then apply it using the Supabase CLI (`supabase db push`) only after explicit approval.
5. Verify the migration history, tables, RLS flags/policies, private buckets, and trigger/functions in the Dashboard. This repository does not run remote migrations automatically.

## Dashboard configuration still required

- **Authentication → URL Configuration:** set the production Site URL and allow only the application's required local/staging/production redirect URLs.
- **Authentication → Providers:** configure the intended sign-in provider(s), email delivery, confirmation and password rules. Use a production email provider before sending invitations or verification links.
- **Authentication → Security:** configure rate limits, CAPTCHA/bot protection as appropriate, session policies, and password protections.
- **Storage:** verify `identity-documents`, `driver-documents`, and `profile-photos` are private and that the migration's policies are present. Do not enable public access or create public URLs for identity/driver documents.
- **Database → Extensions / Cron:** enable `pg_cron` in the project if supported by the selected plan, then schedule the trusted deadline worker below.
- **API settings:** verify only the public publishable key is used by the browser and keep service-role/secret keys in trusted server environments.
- **Backups and monitoring:** establish backup retention, database alerts, Auth logging, Storage retention, and audit-log retention appropriate to the service.

### Five-day restriction schedule

The database helper `current_account_is_restricted()` checks the deadline against database time on every call, so a delayed schedule does not allow new transactions after the deadline when future transaction policies use the provided guards. The scheduled function persists account status and audit events. After enabling `pg_cron`, schedule it once:

```sql
select cron.schedule(
  'sureseat-verification-deadlines',
  '*/15 * * * *',
  $$select public.restrict_expired_unverified_accounts();$$
);
```

Check `cron.job` for an existing job before scheduling to avoid duplicate schedules, and monitor `cron.job_run_details`. The function is safe to execute repeatedly. Do not call it from a browser.

## First Super Admin bootstrap

After the migration is applied and the intended person has registered and verified their Auth account, an authorized database operator must run the one-time function from the Dashboard SQL Editor with that Auth user UUID:

```sql
select public.bootstrap_first_super_admin('AUTH_USER_UUID');
```

The function refuses to run after a Super Admin already exists and is not executable by `anon` or `authenticated`. Protect the Dashboard account and confirm the target UUID independently. Do not grant the role through browser metadata, client code, or a public signup flow.

## Invitation delivery

The database invitation function returns a one-time random token to an already authorized administrator and stores only its hash. A trusted invitation sender still needs to deliver an acceptance link. Do not write tokens to application logs or audit details. The recipient must sign in with the invited email before acceptance.

## RLS and future SureSeat data

The migration protects only tables it creates. Before connecting bookings, subscriptions, payments, routes, fares, vehicles, or location data to Supabase, add table-specific RLS policies/mutation functions and audit handling. Policies must use the account restriction guards for creation of new bookings/subscriptions, preserve existing paid records, and separately authorize passenger, assigned-driver, staff, administrator, and Super Admin access. Do not rely on React route guards.

## Tests

Run `npx supabase test db` with the local Supabase stack. SQL tests use pgTAP fixtures and verify own-record isolation, assigned staff scopes, administrative access, role escalation resistance, private document access, and trusted deadline enforcement. They are not a substitute for reviewing policies against the live schema.
