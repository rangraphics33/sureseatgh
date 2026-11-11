# SureSeat 2.0 Authentication and Access Specification

## Status and scope

This document defines the intended authentication and authorization foundation for SureSeat 2.0. The current frontend remains in preview/API mode; adding the Supabase SDK and database migrations does not activate authentication or connect bookings, subscriptions, payments, driver operations, or live tracking to Supabase. SQL migrations are prepared locally and have not been applied to the hosted project.

Supabase Auth is the planned identity provider. A single authenticated account may have more than one application role. Authorization is enforced by PostgreSQL Row Level Security (RLS), narrowly scoped database functions, and private Storage policies. Frontend role checks are presentation-only and are never the security boundary.

## Roles

### Super Admin

- Has platform-level control.
- Is the only application role allowed to create or revoke administrator access and invite administrators.
- Controls platform-level permissions and bootstrap access.
- Is created through a one-time, service-role-only bootstrap procedure after an authorized person has an existing authenticated account.
- Is not assigned through public signup, user-editable metadata, or ordinary role-management calls.

### Administrator

- Has full operational access to SureSeat, subject to database policies and audit logging.
- May operate on passenger trips/bookings, subscriptions, routes, fares, vehicles, driver and identity applications, and staff access.
- May assign individual operational permissions to staff but cannot grant platform-level access or manage administrator accounts.
- Must not approve or reject their own identity or driver application.
- May invite staff; only a Super Admin may invite an Administrator.

The current migration establishes administrator access controls and policies for the new identity/access tables. Operational policies for future booking, subscription, route, fare, and vehicle tables must be added alongside those tables before those resources are connected.

### Staff

- Receives only explicit permissions assigned by an Administrator or Super Admin.
- Cannot grant or revoke permissions, modify role assignments, invite privileged accounts, or approve their own submissions.
- Cannot receive `platform.*` permissions.
- Permission assignments are recorded with the assigning user and are auditable.

The initial permission catalog is intentionally limited to operational scopes such as passenger, booking, subscription, route, driver, vehicle, identity-review, report, audit, and support access. It can be expanded by a reviewed database migration.

### Passenger

- Is the default role on account registration.
- Retains passenger role and existing records if the account is later approved as a Driver.
- May read and submit their own identity verification and driver application records, and access other records only under policies added for those resources.

### Driver

- Is added to the same user's role set only after an Administrator or Super Admin approves a driver application.
- Does not require or create a separate account.
- Does not receive driver operations or another user's records merely by holding the Driver role; each future operational table requires explicit RLS policies.

## Registration and identity verification

1. Supabase Auth creates the account. A database trigger creates the profile, assigns the Passenger role, and sets `verification_deadline_at` to the trusted Auth registration timestamp plus five days.
2. Passenger access remains available during that five-day window, regardless of whether a verification submission is pending or rejected.
3. Identity verification starts as a manual Ghana Card review. Documents are uploaded only to the private `identity-documents` bucket.
4. An authorized Administrator, Super Admin, or staff member with the specifically assigned identity-review permission may approve or reject another user's submission. A user cannot review their own identity.
5. Approval marks the profile verified and active. Future automated verification may be introduced only through a reviewed server integration; it must not allow the browser to set approval status.
6. If the deadline passes without approval, trusted database time immediately makes the account restricted for transaction eligibility, even if the scheduled persistence job has not run yet. The scheduled job persists the restricted status and audit event and is safe to rerun.
7. A restricted user may still authenticate, read their own profile and verification status, submit a new verification document, and access support. They may not create bookings or subscriptions.
8. Restriction does not delete or alter existing bookings, paid subscriptions, payment records, or uploaded records. No such operational tables are changed by the current migration.

The five-day check must be enforced by database/server time and by the future booking/subscription authorization paths. A browser timer or client-supplied timestamp is not authoritative. The migration exposes `current_account_can_create_bookings()` and `current_account_can_create_subscriptions()` for those future RLS policies or trusted mutation functions.

## Driver application and approval

- A Passenger applies for a Driver role using the same account and uploads supporting files to the private `driver-documents` bucket.
- The application begins in `pending` state. The applicant can read their own status but cannot set review fields or change status.
- Driver approval is a separate process from Ghana Card verification and is mandatory.
- Only an Administrator or Super Admin can approve or reject a Driver application. Staff permissions do not substitute for administrator approval.
- Approval adds the `driver` role without removing `passenger`. Review actions write an audit event.

## Administrator and staff invitations

- Invitations are generated by a privileged database function; only a cryptographically random token hash is stored.
- Invitations are restricted to `administrator` or `staff`; there is no public invitation or role-selection flow.
- Only a Super Admin can invite an Administrator. Administrators and Super Admins can invite Staff.
- A Staff invitation may carry a list of individually assignable operational permissions. Platform-level permissions are rejected.
- The invited person must authenticate with the invited email and present the unexpired invitation token to accept it. Acceptance is atomic, one-time, and rechecks that the inviter still has authority.
- Tokens expire, can be revoked, and are not readable through ordinary table access.
- Delivery of invitation emails is not implemented in this frontend foundation. A trusted email/Edge Function flow must deliver links without logging or exposing tokens.

## Audit and sensitive documents

- Administrative role changes, invitations, permission assignments, identity decisions, driver decisions, and automated verification restrictions are recorded in `audit_logs`.
- Authenticated users cannot directly insert, update, or delete audit entries. The table is append-only through controlled database functions.
- Audit event details must not contain passwords, tokens, full Ghana Card numbers, document contents, payment secrets, or other unnecessary sensitive data.
- Restricted users can create and read their own support requests. Authorized staff and administrators can review support requests; status changes go through an audited database function.
- Ghana Card and driver documents are private Storage objects. Their paths are scoped under the owner's user UUID. Owners may upload and read their own files; authorized reviewers may read them. No public object or public URL is allowed.
- Profile photos are also stored in a private bucket in this foundation. Signed URLs must be short-lived and issued only after Storage authorization.
- File size and MIME-type restrictions are configured per bucket. Server-side file validation and malware scanning remain deployment requirements.

## Access control invariants

1. Users cannot grant themselves roles, permissions, or an approval status.
2. Staff cannot assign permissions, including to themselves.
3. Only a Super Admin manages administrator accounts and platform-level permissions.
4. Staff permissions are individually granted and are evaluated by database functions/policies.
5. Administrative approval is required for every Driver role.
6. Users cannot approve their own identity or Driver application.
7. Passenger and Driver access is limited to the user's own records except where an explicit authorized operational role/permission grants access.
8. RLS is enabled on each protected table. Storage buckets remain private. Frontend checks do not replace these policies.
9. Restricted users retain authentication and verification/support access but cannot create new bookings or subscriptions.
10. Migrations are not proof that the hosted database is configured; Dashboard settings and migration application must be completed and verified separately.

## Implementation boundary

The current foundation prepares profile/role/permission, invitation, application, verification, support-request, and audit tables; database functions; RLS; private Storage buckets; and a scheduled restriction function. It does not implement login screens, session UI, authentication routing, email delivery, booking/subscription persistence, payments, location tracking, or deployment automation.
