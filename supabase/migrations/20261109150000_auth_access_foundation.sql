begin;

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  avatar_path text,
  account_status text not null default 'active'
    check (account_status in ('active', 'restricted')),
  verification_deadline_at timestamptz not null,
  identity_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'administrator', 'staff', 'passenger', 'driver')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index user_roles_user_role_idx on public.user_roles (user_id, role);

create table public.staff_permissions (
  permission_code text primary key,
  description text not null,
  created_at timestamptz not null default now(),
  check (permission_code !~ '^platform\.')
);

insert into public.staff_permissions (permission_code, description) values
  ('passengers.read', 'View passenger records'),
  ('bookings.read', 'View bookings and passenger trips'),
  ('bookings.manage', 'Manage bookings operationally'),
  ('subscriptions.read', 'View subscription records'),
  ('subscriptions.manage', 'Manage subscriptions operationally'),
  ('routes.read', 'View routes and fares'),
  ('routes.manage', 'Manage routes and fares'),
  ('drivers.read', 'View driver records'),
  ('drivers.approve', 'Review driver applications'),
  ('vehicles.manage', 'Manage vehicles'),
  ('verification.review', 'Review identity verification submissions'),
  ('reports.read', 'View operational reports'),
  ('audit.read', 'View administrative audit events'),
  ('support.manage', 'Manage passenger support cases')
on conflict (permission_code) do nothing;

create table public.staff_permission_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users (id) on delete cascade,
  permission_code text not null references public.staff_permissions (permission_code) on delete restrict,
  granted_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (staff_user_id, permission_code)
);

create index staff_permission_assignments_user_idx
  on public.staff_permission_assignments (staff_user_id, permission_code);

create table public.driver_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  vehicle_type text not null,
  experience_years integer not null check (experience_years between 0 and 80),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null))
);

create index driver_applications_status_created_idx
  on public.driver_applications (status, created_at desc);
create unique index driver_applications_one_pending_per_user_idx
  on public.driver_applications (user_id) where status = 'pending';

create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  verification_method text not null default 'manual'
    check (verification_method in ('manual', 'api')),
  document_object_path text not null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)),
  check (document_object_path !~ '^/')
);

create unique index identity_verifications_one_pending_per_user_idx
  on public.identity_verifications (user_id) where status = 'pending';
create index identity_verifications_status_created_idx
  on public.identity_verifications (status, created_at desc);

create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email))),
  invited_role text not null check (invited_role in ('administrator', 'staff')),
  requested_permissions text[] not null default '{}',
  token_hash bytea not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users (id) on delete restrict,
  accepted_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((invited_role = 'staff') or cardinality(requested_permissions) = 0),
  check ((status = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_by is null and accepted_at is null))
);

create unique index admin_invitations_one_pending_email_idx
  on public.admin_invitations (email) where status = 'pending';
create index admin_invitations_inviter_created_idx
  on public.admin_invitations (invited_by, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  subject_user_id uuid references auth.users (id) on delete set null,
  action text not null check (length(btrim(action)) > 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_created_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_subject_created_idx on public.audit_logs (subject_user_id, created_at desc);

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null check (topic in ('Booking a ride', 'My trip', 'Payments', 'Account verification', 'Other')),
  message text not null check (length(btrim(message)) between 10 and 5000),
  reply_email text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_requests_user_created_idx
  on public.support_requests (user_id, created_at desc);
create index support_requests_status_created_idx
  on public.support_requests (status, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger driver_applications_set_updated_at
before update on public.driver_applications
for each row execute function public.set_updated_at();

create trigger identity_verifications_set_updated_at
before update on public.identity_verifications
for each row execute function public.set_updated_at();

create trigger support_requests_set_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, verification_deadline_at)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    coalesce(new.created_at, now()) + interval '5 days'
  );

  insert into public.user_roles (user_id, role)
  values (new.id, 'passenger');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create function public.current_user_has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = p_role
  );
$$;

create function public.current_user_has_permission(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.current_user_has_role('super_admin')
    or (
      public.current_user_has_role('administrator')
      and p_permission_code not like 'platform.%'
    )
    or exists (
      select 1
      from public.staff_permission_assignments spa
      join public.user_roles ur
        on ur.user_id = spa.staff_user_id
       and ur.role = 'staff'
      where spa.staff_user_id = auth.uid()
        and spa.permission_code = p_permission_code
    );
$$;

create function public.current_account_is_restricted()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.account_status = 'restricted'
      or (
        p.identity_verified_at is null
        and now() >= p.verification_deadline_at
      )
    from public.profiles p
    where p.id = auth.uid()
  ), true);
$$;

create function public.current_account_can_create_bookings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and not public.current_account_is_restricted();
$$;

create function public.current_account_can_create_subscriptions()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and not public.current_account_is_restricted();
$$;

create function public.write_audit_log(
  p_action text,
  p_subject_user_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log_id uuid;
begin
  insert into public.audit_logs (actor_id, subject_user_id, action, details)
  values (auth.uid(), p_subject_user_id, p_action, coalesce(p_details, '{}'::jsonb))
  returning id into v_log_id;
  return v_log_id;
end;
$$;

create function public.bootstrap_first_super_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('sureseat-bootstrap-first-super-admin'));

  if exists (select 1 from public.user_roles where role = 'super_admin') then
    raise exception 'A super administrator has already been bootstrapped.'
      using errcode = '23505';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'The target account does not exist.' using errcode = '23503';
  end if;

  insert into public.user_roles (user_id, role)
  values (p_user_id, 'super_admin');

  perform public.write_audit_log(
    'access.bootstrap_super_admin',
    p_user_id,
    jsonb_build_object('method', 'one_time_dashboard_bootstrap')
  );
end;
$$;

create function public.set_administrator_access(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('super_admin') then
    raise exception 'Only a super administrator can manage administrator access.'
      using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use a different super administrator to change your own account.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'The target account does not exist.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'super_admin'
  ) then
    raise exception 'Administrator access cannot change a super administrator role.'
      using errcode = '42501';
  end if;

  if p_enabled then
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, 'administrator', auth.uid())
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = 'administrator';
  end if;

  perform public.write_audit_log(
    case when p_enabled then 'access.administrator_granted' else 'access.administrator_revoked' end,
    p_user_id,
    '{}'::jsonb
  );
end;
$$;

create function public.set_staff_permission(
  p_staff_user_id uuid,
  p_permission_code text,
  p_granted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('administrator')
  ) then
    raise exception 'Only an administrator can assign staff permissions.'
      using errcode = '42501';
  end if;
  if p_staff_user_id = auth.uid() then
    raise exception 'An administrator cannot assign permissions to their own account.'
      using errcode = '42501';
  end if;
  if p_permission_code like 'platform.%'
    or not exists (
      select 1 from public.staff_permissions
      where permission_code = p_permission_code
    ) then
    raise exception 'The requested permission is not assignable.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_roles
    where user_id = p_staff_user_id and role = 'staff'
  ) then
    raise exception 'The target account is not staff.' using errcode = '23514';
  end if;

  if p_granted then
    insert into public.staff_permission_assignments (
      staff_user_id, permission_code, granted_by
    ) values (p_staff_user_id, p_permission_code, auth.uid())
    on conflict (staff_user_id, permission_code)
    do update set granted_by = excluded.granted_by;
  else
    delete from public.staff_permission_assignments
    where staff_user_id = p_staff_user_id
      and permission_code = p_permission_code;
  end if;

  perform public.write_audit_log(
    case when p_granted then 'access.staff_permission_granted'
      else 'access.staff_permission_revoked' end,
    p_staff_user_id,
    jsonb_build_object('permission_code', p_permission_code)
  );
end;
$$;

create function public.issue_admin_invitation(
  p_email text,
  p_role text,
  p_staff_permissions text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_permission text;
  v_invitation_id uuid;
begin
  if p_role not in ('administrator', 'staff') then
    raise exception 'Only administrator or staff invitations are supported.'
      using errcode = '22023';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'A valid invitation email is required.' using errcode = '22023';
  end if;
  if exists (
    select 1 from auth.users
    where id = auth.uid() and lower(email) = v_email
  ) then
    raise exception 'You cannot invite your own account.' using errcode = '42501';
  end if;
  if p_role = 'administrator' and not public.current_user_has_role('super_admin') then
    raise exception 'Only a super administrator can invite administrators.'
      using errcode = '42501';
  end if;
  if p_role = 'staff' and not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('administrator')
  ) then
    raise exception 'Only an administrator can invite staff.' using errcode = '42501';
  end if;
  if p_role = 'administrator' and cardinality(coalesce(p_staff_permissions, '{}')) > 0 then
    raise exception 'Administrator invitations cannot include staff permissions.'
      using errcode = '22023';
  end if;

  foreach v_permission in array coalesce(p_staff_permissions, '{}') loop
    if v_permission like 'platform.%'
      or not exists (
        select 1 from public.staff_permissions
        where permission_code = v_permission
      ) then
      raise exception 'An invitation contains an unassignable permission.'
        using errcode = '22023';
    end if;
  end loop;

  update public.admin_invitations
  set status = 'revoked'
  where email = v_email and status = 'pending';

  insert into public.admin_invitations (
    email, invited_role, requested_permissions, token_hash, invited_by
  ) values (
    v_email,
    p_role,
    coalesce(p_staff_permissions, '{}'),
    extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
    auth.uid()
  )
  returning id into v_invitation_id;

  perform public.write_audit_log(
    'access.invitation_issued',
    null,
    jsonb_build_object(
      'invitation_id', v_invitation_id,
      'invited_role', p_role,
      'email', v_email
    )
  );

  return v_token;
end;
$$;

create function public.accept_admin_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invitation public.admin_invitations%rowtype;
  v_permission text;
begin
  if v_user_id is null then
    raise exception 'Sign in with the invited account before accepting.'
      using errcode = '28000';
  end if;

  select lower(email) into v_email
  from auth.users where id = v_user_id;

  if v_email is null then
    raise exception 'The signed-in account has no email address.'
      using errcode = '28000';
  end if;

  select * into v_invitation
  from public.admin_invitations
  where token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
  for update;

  if not found or v_invitation.status <> 'pending'
    or v_invitation.expires_at <= now()
    or v_invitation.email <> v_email then
    raise exception 'The invitation is invalid, expired, or for another account.'
      using errcode = '22023';
  end if;
  if v_invitation.invited_role = 'administrator'
    and not exists (
      select 1 from public.user_roles
      where user_id = v_invitation.invited_by and role = 'super_admin'
    ) then
    raise exception 'The administrator invitation is no longer authorized.'
      using errcode = '42501';
  end if;
  if v_invitation.invited_role = 'staff'
    and not exists (
      select 1 from public.user_roles
      where user_id = v_invitation.invited_by
        and role in ('administrator', 'super_admin')
    ) then
    raise exception 'The staff invitation is no longer authorized.'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_roles
    where user_id = v_user_id and role = v_invitation.invited_role
  ) then
    raise exception 'The account already has the invited role.'
      using errcode = '23505';
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (v_user_id, v_invitation.invited_role, v_invitation.invited_by);

  if v_invitation.invited_role = 'staff' then
    foreach v_permission in array v_invitation.requested_permissions loop
      insert into public.staff_permission_assignments (
        staff_user_id, permission_code, granted_by
      ) values (v_user_id, v_permission, v_invitation.invited_by)
      on conflict (staff_user_id, permission_code) do nothing;
    end loop;
  end if;

  update public.admin_invitations
  set status = 'accepted', accepted_by = v_user_id, accepted_at = now()
  where id = v_invitation.id;

  perform public.write_audit_log(
    'access.invitation_accepted',
    v_user_id,
    jsonb_build_object('invitation_id', v_invitation.id, 'role', v_invitation.invited_role)
  );

  return v_invitation.invited_role;
end;
$$;

create function public.revoke_admin_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.admin_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before revoking an invitation.' using errcode = '28000';
  end if;

  select * into v_invitation
  from public.admin_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'The invitation was not found.' using errcode = 'P0002';
  end if;
  if not (
    public.current_user_has_role('super_admin')
    or (
      v_invitation.invited_role = 'staff'
      and public.current_user_has_role('administrator')
    )
  ) then
    raise exception 'You are not authorized to revoke this invitation.'
      using errcode = '42501';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked.'
      using errcode = '23514';
  end if;

  update public.admin_invitations
  set status = 'revoked'
  where id = p_invitation_id;

  perform public.write_audit_log(
    'access.invitation_revoked',
    null,
    jsonb_build_object(
      'invitation_id', p_invitation_id,
      'invited_role', v_invitation.invited_role
    )
  );
end;
$$;

create function public.review_identity_verification(
  p_verification_id uuid,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_status text;
begin
  if auth.uid() is null or not (
    public.current_user_has_role('administrator')
    or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('verification.review')
  ) then
    raise exception 'You are not authorized to review identity verification.'
      using errcode = '42501';
  end if;

  select user_id, status into v_user_id, v_status
  from public.identity_verifications
  where id = p_verification_id
  for update;

  if not found then
    raise exception 'The verification record was not found.' using errcode = 'P0002';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'You cannot approve or reject your own verification.'
      using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending verification submissions can be reviewed.'
      using errcode = '23514';
  end if;

  update public.identity_verifications
  set status = case when p_approved then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_verification_id;

  perform public.write_audit_log(
    case when p_approved then 'identity_verification.approved'
      else 'identity_verification.rejected' end,
    v_user_id,
    jsonb_build_object('verification_id', p_verification_id)
  );
end;
$$;

create function public.sync_approved_identity_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    update public.profiles
    set account_status = 'active',
        identity_verified_at = coalesce(new.reviewed_at, now())
    where id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger identity_verification_approved
after update of status on public.identity_verifications
for each row execute function public.sync_approved_identity_verification();

create function public.review_driver_application(
  p_application_id uuid,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_status text;
begin
  if auth.uid() is null or not (
    public.current_user_has_role('administrator')
    or public.current_user_has_role('super_admin')
  ) then
    raise exception 'Only an administrator can approve driver applications.'
      using errcode = '42501';
  end if;

  select user_id, status into v_user_id, v_status
  from public.driver_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'The driver application was not found.' using errcode = 'P0002';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'You cannot review your own driver application.'
      using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending driver applications can be reviewed.'
      using errcode = '23514';
  end if;

  update public.driver_applications
  set status = case when p_approved then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_application_id;

  if p_approved then
    insert into public.user_roles (user_id, role, granted_by)
    values (v_user_id, 'driver', auth.uid())
    on conflict (user_id, role) do nothing;
  end if;

  perform public.write_audit_log(
    case when p_approved then 'driver_application.approved'
      else 'driver_application.rejected' end,
    v_user_id,
    jsonb_build_object('application_id', p_application_id)
  );
end;
$$;

create function public.update_support_request(
  p_request_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_previous_status text;
begin
  if auth.uid() is null or not (
    public.current_user_has_role('administrator')
    or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('support.manage')
  ) then
    raise exception 'You are not authorized to manage support requests.'
      using errcode = '42501';
  end if;
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception 'The requested support status is invalid.'
      using errcode = '22023';
  end if;

  select user_id, status into v_user_id, v_previous_status
  from public.support_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'The support request was not found.' using errcode = 'P0002';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'You cannot manage your own support request.'
      using errcode = '42501';
  end if;
  if v_previous_status = p_status then
    raise exception 'The support request already has that status.'
      using errcode = '23514';
  end if;

  update public.support_requests
  set status = p_status
  where id = p_request_id;

  perform public.write_audit_log(
    'support_request.status_changed',
    v_user_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'from', v_previous_status,
      'to', p_status
    )
  );
end;
$$;

create function public.restrict_expired_unverified_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_count integer := 0;
begin
  for v_user_id in
    update public.profiles p
    set account_status = 'restricted'
    where p.account_status = 'active'
      and p.identity_verified_at is null
      and p.verification_deadline_at <= now()
    returning p.id
  loop
    v_count := v_count + 1;
    perform public.write_audit_log(
      'account.verification_deadline_restricted',
      v_user_id,
      jsonb_build_object('enforced_at', now())
    );
  end loop;
  return v_count;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.staff_permissions enable row level security;
alter table public.staff_permission_assignments enable row level security;
alter table public.driver_applications enable row level security;
alter table public.identity_verifications enable row level security;
alter table public.admin_invitations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.support_requests enable row level security;

revoke all on public.profiles, public.user_roles, public.staff_permissions,
  public.staff_permission_assignments, public.driver_applications,
  public.identity_verifications, public.admin_invitations, public.audit_logs,
  public.support_requests
from anon, authenticated;

grant select on public.profiles, public.user_roles, public.staff_permissions,
  public.staff_permission_assignments, public.driver_applications,
  public.identity_verifications, public.audit_logs,
  public.support_requests
to authenticated;
grant select (
  id, email, invited_role, requested_permissions, status, invited_by,
  accepted_by, expires_at, accepted_at, created_at
) on public.admin_invitations to authenticated;
grant update (full_name, phone, avatar_path) on public.profiles to authenticated;
grant insert (user_id, vehicle_type, experience_years)
  on public.driver_applications to authenticated;
grant insert (user_id, document_object_path)
  on public.identity_verifications to authenticated;
grant insert (user_id, topic, message, reply_email)
  on public.support_requests to authenticated;

create policy profiles_read_own_or_authorized
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
  or public.current_user_has_permission('passengers.read')
);

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy user_roles_read_authorized
on public.user_roles for select to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_role('super_admin')
  or (
    role <> 'super_admin'
    and public.current_user_has_role('administrator')
  )
);

create policy staff_permissions_read_authenticated
on public.staff_permissions for select to authenticated
using (true);

create policy staff_assignments_read_own_or_admin
on public.staff_permission_assignments for select to authenticated
using (
  staff_user_id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
);

create policy driver_applications_read_own_or_admin
on public.driver_applications for select to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
);

create policy driver_applications_insert_own
on public.driver_applications for insert to authenticated
with check (
  user_id = auth.uid()
  and not public.current_user_has_role('driver')
);

create policy identity_verifications_read_authorized
on public.identity_verifications for select to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
  or public.current_user_has_permission('verification.review')
);

create policy identity_verifications_insert_own
on public.identity_verifications for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and verification_method = 'manual'
  and reviewed_by is null
  and reviewed_at is null
  and document_object_path like (auth.uid()::text || '/%')
);

create policy invitations_read_inviter_or_role_admin
on public.admin_invitations for select to authenticated
using (
  invited_by = auth.uid()
  or public.current_user_has_role('super_admin')
  or (
    invited_role = 'staff'
    and public.current_user_has_role('administrator')
  )
);

create policy audit_logs_read_authorized
on public.audit_logs for select to authenticated
using (
  actor_id = auth.uid()
  or subject_user_id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
  or public.current_user_has_permission('audit.read')
);

create policy support_requests_read_own_or_authorized
on public.support_requests for select to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
  or public.current_user_has_permission('support.manage')
);

create policy support_requests_insert_own
on public.support_requests for insert to authenticated
with check (user_id = auth.uid());

grant execute on function public.current_user_has_role(text) to authenticated, service_role;
grant execute on function public.current_user_has_permission(text) to authenticated, service_role;
grant execute on function public.current_account_is_restricted() to authenticated, service_role;
grant execute on function public.current_account_can_create_bookings() to authenticated, service_role;
grant execute on function public.current_account_can_create_subscriptions() to authenticated, service_role;
grant execute on function public.set_administrator_access(uuid, boolean) to authenticated;
grant execute on function public.set_staff_permission(uuid, text, boolean) to authenticated;
grant execute on function public.issue_admin_invitation(text, text, text[]) to authenticated;
grant execute on function public.accept_admin_invitation(text) to authenticated;
grant execute on function public.revoke_admin_invitation(uuid) to authenticated;
grant execute on function public.review_identity_verification(uuid, boolean) to authenticated;
grant execute on function public.review_driver_application(uuid, boolean) to authenticated;
grant execute on function public.update_support_request(uuid, text) to authenticated;
grant execute on function public.restrict_expired_unverified_accounts() to service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.current_user_has_role(text) from public, anon;
revoke all on function public.current_user_has_permission(text) from public, anon;
revoke all on function public.current_account_is_restricted() from public, anon;
revoke all on function public.current_account_can_create_bookings() from public, anon;
revoke all on function public.current_account_can_create_subscriptions() from public, anon;
revoke all on function public.bootstrap_first_super_admin(uuid) from public, anon, authenticated;
revoke all on function public.set_administrator_access(uuid, boolean) from public, anon;
revoke all on function public.set_staff_permission(uuid, text, boolean) from public, anon;
revoke all on function public.issue_admin_invitation(text, text, text[]) from public, anon;
revoke all on function public.accept_admin_invitation(text) from public, anon;
revoke all on function public.revoke_admin_invitation(uuid) from public, anon;
revoke all on function public.review_identity_verification(uuid, boolean) from public, anon;
revoke all on function public.review_driver_application(uuid, boolean) from public, anon;
revoke all on function public.update_support_request(uuid, text) from public, anon;
revoke all on function public.restrict_expired_unverified_accounts() from public, anon, authenticated;
revoke all on function public.sync_approved_identity_verification() from public, anon, authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid) to service_role;
revoke all on function public.write_audit_log(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('identity-documents', 'identity-documents', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('driver-documents', 'driver-documents', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('profile-photos', 'profile-photos', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy identity_documents_read_owner_or_reviewer
on storage.objects for select to authenticated
using (
  bucket_id = 'identity-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_has_permission('verification.review')
  )
);

create policy identity_documents_insert_owner
on storage.objects for insert to authenticated
with check (
  bucket_id = 'identity-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy driver_documents_read_owner_or_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'driver-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_has_permission('drivers.approve')
  )
);

create policy driver_documents_insert_owner
on storage.objects for insert to authenticated
with check (
  bucket_id = 'driver-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy profile_photos_read_owner_or_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_has_permission('passengers.read')
  )
);

create policy profile_photos_insert_owner
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy sureseat_private_buckets_select_guard
on storage.objects as restrictive for select to public
using (
  bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos')
  or (
    auth.role() = 'authenticated'
    and (
      (
        bucket_id = 'identity-documents'
        and (
          (storage.foldername(name))[1] = auth.uid()::text
          or public.current_user_has_permission('verification.review')
        )
      )
      or (
        bucket_id = 'driver-documents'
        and (
          (storage.foldername(name))[1] = auth.uid()::text
          or public.current_user_has_permission('drivers.approve')
        )
      )
      or (
        bucket_id = 'profile-photos'
        and (
          (storage.foldername(name))[1] = auth.uid()::text
          or public.current_user_has_permission('passengers.read')
        )
      )
    )
  )
);

create policy sureseat_private_buckets_insert_guard
on storage.objects as restrictive for insert to public
with check (
  bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos')
  or (
    auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
);

create policy sureseat_private_buckets_update_guard
on storage.objects as restrictive for update to public
using (bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos'))
with check (bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos'));

create policy sureseat_private_buckets_delete_guard
on storage.objects as restrictive for delete to public
using (bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos'));

commit;
