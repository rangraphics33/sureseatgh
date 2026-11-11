# Vehicle and fleet administration

The fleet module uses the reviewed migration `supabase/migrations/20261109235000_vehicle_fleet_management.sql`. It is intentionally prepared but has **not** been applied to any Supabase project.

## Data and access model

- `vehicles` stores normalized unique registrations, vehicle details, and operational status.
- `vehicle_documents` stores registration, insurance, and roadworthiness metadata. File contents stay in the private `vehicle-documents` Storage bucket.
- `vehicle_assignments` records assignment history and permits at most one active vehicle per driver and one active driver per vehicle.
- `vehicle_maintenance_records` tracks service history, status, and due dates.
- All administrative writes use `SECURITY DEFINER` RPCs that check the existing `current_user_has_permission('vehicles.manage')` helper and write to the existing audit log.
- RLS allows drivers to read only their currently assigned vehicle and assignment. Driver document status is exposed through a narrow RPC that omits storage paths and filenames. Private file reads and signed URLs require `vehicles.manage`.
- Assignments require an active vehicle, an active account with an approved driver application and driver role, and current approved insurance and roadworthiness documents. These checks run in the database, not just in React.

## Before enabling in an environment

1. Review the migration alongside the existing auth/access and driver-document migrations. Confirm the one-active-driver/one-active-vehicle rule with operations.
2. Apply it to a disposable or staging Supabase project first. This repository does not run `supabase db push` automatically.
3. Run the Supabase database tests and verify the resulting RLS policies, private bucket, assignment eligibility, audit events, and signed URLs using separate administrator, fleet-staff, driver, and passenger accounts.
4. After approval, apply the migration through the team's normal reviewed deployment process, then verify the private bucket remains non-public and set up existing deployment backups/rollback procedures.
5. Configure the client with the normal Supabase URL and publishable key. Never provide a service-role key to the browser.

Bookings, active-trip counts, and payment/subscription reporting remain visibly unavailable on the Admin Dashboard because no corresponding tables or admin reporting endpoints are defined by the migrations in this repository. Do not treat preview data as production data.
