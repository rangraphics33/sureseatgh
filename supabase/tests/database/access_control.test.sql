begin;

select plan(42);

create temp table invitation_tokens (token text not null);
grant select, insert on invitation_tokens to authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'superadmin@example.test', 'test-password', now(), '{}', '{}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@example.test', 'test-password', now(), '{}', '{}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'staff@example.test', 'test-password', now(), '{}', '{}', now(), now()),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'passenger@example.test', 'test-password', now(), '{}', '{}', now(), now()),
  ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'other@example.test', 'test-password', now(), '{}', '{}', now(), now()),
  ('66666666-6666-4666-8666-666666666666', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'expired@example.test', 'test-password', now(), '{}', '{}', now(), now()),
  ('77777777-7777-4777-8777-777777777777', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'driver@example.test', 'test-password', now(), '{}', '{}', now(), now());

select public.bootstrap_first_super_admin('11111111-1111-4111-8111-111111111111');

insert into public.user_roles (user_id, role)
values
  ('22222222-2222-4222-8222-222222222222', 'administrator'),
  ('33333333-3333-4333-8333-333333333333', 'staff'),
  ('77777777-7777-4777-8777-777777777777', 'driver');

insert into public.staff_permission_assignments (staff_user_id, permission_code, granted_by)
values
  ('33333333-3333-4333-8333-333333333333', 'passengers.read', '22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333', 'verification.review', '22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333', 'support.manage', '22222222-2222-4222-8222-222222222222');

update public.profiles
set verification_deadline_at = now() + interval '1 day'
where id <> '66666666-6666-4666-8666-666666666666';

update public.profiles
set verification_deadline_at = now() - interval '1 minute'
where id = '66666666-6666-4666-8666-666666666666';

insert into public.identity_verifications (id, user_id, document_object_path)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444',
    '44444444-4444-4444-8444-444444444444/id-card.pdf'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '55555555-5555-4555-8555-555555555555',
    '55555555-5555-4555-8555-555555555555/id-card.pdf'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222/id-card.pdf');

insert into public.driver_applications (id, user_id, vehicle_type, experience_years)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-4444-4444-8444-444444444444',
    'minibus', 4),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222',
    'minibus', 8);

insert into storage.objects (id, bucket_id, name)
values
  ('88888888-8888-4888-8888-888888888888', 'identity-documents',
    '44444444-4444-4444-8444-444444444444/id-card.pdf'),
  ('99999999-9999-4999-8999-999999999999', 'identity-documents',
    '55555555-5555-4555-8555-555555555555/id-card.pdf'),
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'driver-documents',
    '44444444-4444-4444-8444-444444444444/license.pdf'),
  ('bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'driver-documents',
    '77777777-7777-4777-8777-777777777777/license.pdf');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);

select is(
  (select count(*)::integer from public.profiles where id = auth.uid()),
  1,
  'passengers can read their own profile'
);
select is(
  (select count(*)::integer from public.profiles
   where id = '55555555-5555-4555-8555-555555555555'),
  0,
  'passengers cannot read another passenger profile'
);
select is(
  (select count(*)::integer from public.user_roles
   where user_id = '44444444-4444-4444-8444-444444444444' and role = 'passenger'),
  1,
  'new accounts receive the passenger role'
);
select throws_ok(
  $$insert into public.user_roles (user_id, role)
    values ('44444444-4444-4444-8444-444444444444', 'administrator')$$,
  '42501',
  'passengers cannot assign themselves roles'
);
select ok(public.current_account_can_create_bookings(),
  'a passenger can book during the five-day grace period');
select ok(public.current_account_can_create_subscriptions(),
  'a passenger can subscribe during the five-day grace period');
select is(
  (select count(*)::integer from public.identity_verifications
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'passengers can read their own verification status'
);
select is(
  (select count(*)::integer from public.identity_verifications
   where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'passengers cannot read another user's identity record'
);
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'identity-documents'
     and name = '44444444-4444-4444-8444-444444444444/id-card.pdf'),
  1,
  'document owners can read their own private identity documents'
);
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'identity-documents'
     and name = '55555555-5555-4555-8555-555555555555/id-card.pdf'),
  0,
  'document owners cannot read another user private identity documents'
);

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select ok(not public.current_account_can_create_bookings(),
  'database time denies booking access after the verification deadline');
select ok(not public.current_account_can_create_subscriptions(),
  'database time denies subscriptions after the verification deadline');

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*)::integer from public.profiles
   where id = '44444444-4444-4444-8444-444444444444'),
  1,
  'staff can read records covered by an assigned permission'
);
select is(
  (select count(*)::integer from public.identity_verifications
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'staff with verification review permission can read verification submissions'
);
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'identity-documents'
     and name = '44444444-4444-4444-8444-444444444444/id-card.pdf'),
  1,
  'authorized reviewers can read private identity documents'
);
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'driver-documents'
     and name = '44444444-4444-4444-8444-444444444444/license.pdf'),
  0,
  'identity reviewers cannot read driver documents without driver permission'
);
select throws_ok(
  $$select public.set_staff_permission(
    '33333333-3333-4333-8333-333333333333', 'bookings.manage', true
  )$$,
  '42501',
  'staff cannot grant themselves permissions'
);
select throws_ok(
  $$select public.review_driver_application(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true
  )$$,
  '42501',
  'staff cannot approve driver applications'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*)::integer from public.profiles),
  7,
  'administrators can read operational profiles'
);
select is(
  (select count(*)::integer from public.user_roles
   where user_id = '11111111-1111-4111-8111-111111111111' and role = 'super_admin'),
  0,
  'administrators cannot inspect Super Admin role assignments'
);
select throws_ok(
  $$select public.review_identity_verification(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true
  )$$,
  '42501',
  'administrators cannot approve their own identity'
);
select lives_ok(
  $$select public.review_identity_verification(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true
  )$$,
  'an administrator can review another passenger verification'
);
select is(
  (select account_status from public.profiles
   where id = '44444444-4444-4444-8444-444444444444'),
  'active',
  'approved identity verification keeps the passenger account active'
);
select lives_ok(
  $$select public.review_driver_application(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true
  )$$,
  'an administrator can approve another passenger driver application'
);
select ok(
  exists (
    select 1 from public.user_roles
    where user_id = '44444444-4444-4444-8444-444444444444' and role = 'driver'
  ),
  'administrator approval adds the driver role to the same passenger account'
);
select throws_ok(
  $$select public.set_administrator_access(
    '22222222-2222-4222-8222-222222222222', true
  )$$,
  '42501',
  'administrators cannot manage administrator roles'
);
select throws_ok(
  $$select public.issue_admin_invitation(
    'other@example.test', 'administrator', '{}'::text[]
  )$$,
  '42501',
  'administrators cannot invite other administrators'
);
insert into pg_temp.invitation_tokens (token)
select public.issue_admin_invitation(
  'other@example.test',
  'staff',
  array['routes.read']::text[]
);
select throws_ok(
  $$select token_hash from public.admin_invitations$$,
  '42501',
  'invitation token hashes are not visible through ordinary table access'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'driver_application.approved'
      and subject_user_id = '44444444-4444-4444-8444-444444444444'
  ),
  'administrative driver approval is audited'
);

select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select is(
  public.accept_admin_invitation((select token from pg_temp.invitation_tokens)),
  'staff',
  'the invited account can accept a valid email-matched staff invitation'
);
select ok(
  public.current_user_has_permission('routes.read'),
  'invitation acceptance applies only the assigned staff permission'
);

select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select is(
  (select count(*)::integer from public.profiles where id = auth.uid()),
  1,
  'drivers can read their own profile'
);
select is(
  (select count(*)::integer from public.user_roles
   where user_id = auth.uid() and role = 'driver'),
  1,
  'drivers can read their own driver role'
);
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'driver-documents'
     and name = '77777777-7777-4777-8777-777777777777/license.pdf'),
  1,
  'drivers can read their own private driver documents'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select is(
  public.restrict_expired_unverified_accounts(),
  1,
  'the trusted worker restricts accounts whose five-day deadline passed'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select is(
  (select account_status from public.profiles
   where id = '66666666-6666-4666-8666-666666666666'),
  'restricted',
  'scheduled enforcement persists restricted account status'
);
select ok(not public.current_account_can_create_bookings(),
  'restricted users remain unable to create bookings');
select ok(not public.current_account_can_create_subscriptions(),
  'restricted users remain unable to create subscriptions');
select lives_ok(
  $$insert into public.identity_verifications (user_id, document_object_path)
    values (
      '66666666-6666-4666-8666-666666666666',
      '66666666-6666-4666-8666-666666666666/late-id-card.pdf'
    )$$,
  'restricted users can still submit identity documents'
);
select lives_ok(
  $$insert into public.support_requests (user_id, topic, message, reply_email)
    values (
      '66666666-6666-4666-8666-666666666666',
      'Account verification',
      'Please help me complete my account verification.',
      'expired@example.test'
    )$$,
  'restricted users can still contact support'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*)::integer from public.support_requests
   where user_id = '66666666-6666-4666-8666-666666666666'),
  1,
  'staff with support permission can read support requests'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select is(
  public.restrict_expired_unverified_accounts(),
  0,
  'the restriction process is safe to run repeatedly'
);

select * from finish();
rollback;
