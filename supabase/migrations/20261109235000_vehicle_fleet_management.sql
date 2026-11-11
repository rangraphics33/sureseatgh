begin;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null unique
    check (registration_number = upper(btrim(registration_number))),
  vehicle_type text not null check (length(btrim(vehicle_type)) between 1 and 60),
  make text not null check (length(btrim(make)) between 1 and 80),
  model text not null check (length(btrim(model)) between 1 and 80),
  model_year integer not null check (model_year between 1886 and 2200),
  seating_capacity integer not null check (seating_capacity between 1 and 200),
  status text not null default 'active'
    check (status in ('active', 'maintenance', 'suspended', 'retired')),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vehicles_status_registration_idx
  on public.vehicles (status, registration_number);

create table public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  document_type text not null
    check (document_type in ('registration', 'insurance', 'roadworthiness')),
  object_path text not null unique
    check (object_path !~ '^/' and object_path like (vehicle_id::text || '/%')),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  expiry_date date,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  reviewed_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (document_type not in ('insurance', 'roadworthiness') or expiry_date is not null),
  check (
    (review_status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (review_status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index vehicle_documents_vehicle_type_uploaded_idx
  on public.vehicle_documents (vehicle_id, document_type, uploaded_at desc);
create index vehicle_documents_expiry_idx
  on public.vehicle_documents (expiry_date)
  where review_status = 'approved';

create table public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  driver_user_id uuid not null references auth.users (id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid not null references auth.users (id) on delete restrict,
  check (ended_at is null or ended_at > started_at)
);

create unique index vehicle_assignments_one_active_vehicle_idx
  on public.vehicle_assignments (vehicle_id)
  where ended_at is null;
create unique index vehicle_assignments_one_active_driver_idx
  on public.vehicle_assignments (driver_user_id)
  where ended_at is null;
create index vehicle_assignments_history_idx
  on public.vehicle_assignments (vehicle_id, started_at desc);
create index vehicle_assignments_driver_history_idx
  on public.vehicle_assignments (driver_user_id, started_at desc);

create table public.vehicle_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  service_type text not null check (length(btrim(service_type)) between 1 and 100),
  notes text not null default '' check (length(notes) <= 5000),
  maintenance_date date not null,
  next_due_date date,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_due_date is null or next_due_date >= maintenance_date)
);

create index vehicle_maintenance_vehicle_date_idx
  on public.vehicle_maintenance_records (vehicle_id, maintenance_date desc);
create index vehicle_maintenance_due_idx
  on public.vehicle_maintenance_records (next_due_date)
  where status not in ('completed', 'cancelled');

create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

create trigger vehicle_maintenance_set_updated_at
before update on public.vehicle_maintenance_records
for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
alter table public.vehicle_documents enable row level security;
alter table public.vehicle_assignments enable row level security;
alter table public.vehicle_maintenance_records enable row level security;

grant select on public.vehicles, public.vehicle_documents,
  public.vehicle_assignments, public.vehicle_maintenance_records
to authenticated;

create policy vehicles_read_manager_or_assigned_driver
on public.vehicles for select to authenticated
using (
  public.current_user_has_permission('vehicles.manage')
  or exists (
    select 1
    from public.vehicle_assignments va
    where va.vehicle_id = vehicles.id
      and va.driver_user_id = auth.uid()
      and va.ended_at is null
  )
);

create policy vehicle_documents_read_manager
on public.vehicle_documents for select to authenticated
using (public.current_user_has_permission('vehicles.manage'));

create policy vehicle_assignments_read_manager_or_current_driver
on public.vehicle_assignments for select to authenticated
using (
  public.current_user_has_permission('vehicles.manage')
  or (driver_user_id = auth.uid() and ended_at is null)
);

create policy vehicle_maintenance_read_manager
on public.vehicle_maintenance_records for select to authenticated
using (public.current_user_has_permission('vehicles.manage'));

create or replace function public.create_vehicle(
  p_registration_number text,
  p_vehicle_type text,
  p_make text,
  p_model text,
  p_model_year integer,
  p_seating_capacity integer,
  p_status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_registration_number text := upper(regexp_replace(btrim(p_registration_number), '\s+', ' ', 'g'));
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicles.' using errcode = '42501';
  end if;

  insert into public.vehicles (
    registration_number, vehicle_type, make, model, model_year,
    seating_capacity, status, created_by, updated_by
  ) values (
    v_registration_number, btrim(p_vehicle_type), btrim(p_make), btrim(p_model),
    p_model_year, p_seating_capacity, p_status, auth.uid(), auth.uid()
  )
  returning id into v_vehicle_id;

  perform public.write_audit_log(
    'vehicle.created',
    null,
    jsonb_build_object('vehicle_id', v_vehicle_id, 'registration_number', v_registration_number)
  );
  return v_vehicle_id;
end;
$$;

create or replace function public.update_vehicle(
  p_vehicle_id uuid,
  p_registration_number text,
  p_vehicle_type text,
  p_make text,
  p_model text,
  p_model_year integer,
  p_seating_capacity integer,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
  v_registration_number text := upper(regexp_replace(btrim(p_registration_number), '\s+', ' ', 'g'));
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicles.' using errcode = '42501';
  end if;

  select status into v_previous_status
  from public.vehicles
  where id = p_vehicle_id
  for update;

  if not found then
    raise exception 'The vehicle was not found.' using errcode = 'P0002';
  end if;
  if p_status = 'active' and exists (
    select 1 from public.vehicle_maintenance_records
    where vehicle_id = p_vehicle_id and status = 'in_progress'
  ) then
    raise exception 'A vehicle with in-progress maintenance cannot be made active.'
      using errcode = '23514';
  end if;

  update public.vehicles
  set registration_number = v_registration_number,
      vehicle_type = btrim(p_vehicle_type),
      make = btrim(p_make),
      model = btrim(p_model),
      model_year = p_model_year,
      seating_capacity = p_seating_capacity,
      status = p_status,
      updated_by = auth.uid()
  where id = p_vehicle_id;

  if p_status <> 'active' then
    update public.vehicle_assignments
    set ended_at = greatest(clock_timestamp(), started_at + interval '1 microsecond')
    where vehicle_id = p_vehicle_id and ended_at is null;
  end if;

  perform public.write_audit_log(
    case when p_status <> 'active' and v_previous_status = 'active'
      then 'vehicle.suspended' else 'vehicle.updated' end,
    null,
    jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'registration_number', v_registration_number,
      'previous_status', v_previous_status,
      'status', p_status
    )
  );
end;
$$;

create or replace function public.create_vehicle_document(
  p_vehicle_id uuid,
  p_document_type text,
  p_object_path text,
  p_file_name text,
  p_content_type text,
  p_file_size_bytes bigint,
  p_expiry_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid;
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicle documents.' using errcode = '42501';
  end if;
  if p_object_path !~ ('^' || p_vehicle_id::text || '/')
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'vehicle-documents' and name = p_object_path
    ) then
    raise exception 'The private vehicle document upload could not be verified.'
      using errcode = '23514';
  end if;

  insert into public.vehicle_documents (
    vehicle_id, document_type, object_path, file_name, content_type,
    file_size_bytes, expiry_date, uploaded_by
  ) values (
    p_vehicle_id, p_document_type, p_object_path, btrim(p_file_name),
    p_content_type, p_file_size_bytes, p_expiry_date, auth.uid()
  )
  returning id into v_document_id;

  perform public.write_audit_log(
    'vehicle.document_uploaded',
    null,
    jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'document_id', v_document_id,
      'document_type', p_document_type
    )
  );
  return v_document_id;
end;
$$;

create or replace function public.review_vehicle_document(
  p_document_id uuid,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_document_type text;
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to review vehicle documents.' using errcode = '42501';
  end if;

  select vehicle_id, document_type
  into v_vehicle_id, v_document_type
  from public.vehicle_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'The vehicle document was not found.' using errcode = 'P0002';
  end if;
  update public.vehicle_documents
  set review_status = case when p_approved then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_document_id;

  perform public.write_audit_log(
    case when p_approved then 'vehicle.document_approved' else 'vehicle.document_rejected' end,
    null,
    jsonb_build_object(
      'vehicle_id', v_vehicle_id,
      'document_id', p_document_id,
      'document_type', v_document_type
    )
  );
end;
$$;

create or replace function public.list_eligible_vehicle_drivers()
returns table (driver_user_id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicle assignments.' using errcode = '42501';
  end if;

  return query
  select distinct ur.user_id, coalesce(p.full_name, 'Driver account')
  from public.user_roles ur
  join public.driver_applications da
    on da.user_id = ur.user_id and da.status = 'approved'
  join public.profiles p
    on p.id = ur.user_id and p.account_status = 'active'
  where ur.role = 'driver'
  order by coalesce(p.full_name, 'Driver account'), ur.user_id;
end;
$$;

create or replace function public.get_vehicle_assignment_history(p_vehicle_id uuid)
returns table (
  assignment_id uuid,
  vehicle_id uuid,
  driver_user_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  driver_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicle assignments.' using errcode = '42501';
  end if;

  return query
  select va.id, va.vehicle_id, va.driver_user_id, va.started_at, va.ended_at,
    coalesce(p.full_name, 'Driver account')
  from public.vehicle_assignments va
  left join public.profiles p on p.id = va.driver_user_id
  where va.vehicle_id = p_vehicle_id
  order by va.started_at desc;
end;
$$;

create or replace function public.set_vehicle_assignment(
  p_vehicle_id uuid,
  p_driver_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_status text;
  v_current_assignment_id uuid;
  v_current_driver_id uuid;
  v_driver_existing_assignment_id uuid;
  v_driver_existing_vehicle_id uuid;
  v_assignment_id uuid;
  v_document_type text;
  v_document_status text;
  v_expiry_date date;
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicle assignments.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('sureseat-fleet-assignments')::bigint);

  select status into v_vehicle_status
  from public.vehicles
  where id = p_vehicle_id
  for update;
  if not found then
    raise exception 'The vehicle was not found.' using errcode = 'P0002';
  end if;

  select id, driver_user_id into v_current_assignment_id, v_current_driver_id
  from public.vehicle_assignments
  where vehicle_id = p_vehicle_id and ended_at is null
  for update;

  if p_driver_user_id is null then
    if v_current_assignment_id is not null then
      update public.vehicle_assignments
      set ended_at = greatest(clock_timestamp(), started_at + interval '1 microsecond')
      where id = v_current_assignment_id;
      perform public.write_audit_log(
        'vehicle.assignment_ended',
        v_current_driver_id,
        jsonb_build_object('vehicle_id', p_vehicle_id, 'assignment_id', v_current_assignment_id)
      );
    end if;
    return null;
  end if;

  if v_vehicle_status <> 'active' then
    raise exception 'Only active vehicles can be assigned.' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.user_roles ur
    join public.driver_applications da on da.user_id = ur.user_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_driver_user_id
      and ur.role = 'driver'
      and da.status = 'approved'
      and p.account_status = 'active'
  ) then
    raise exception 'The selected account is not an active, approved driver.'
      using errcode = '23514';
  end if;

  foreach v_document_type in array array['registration', 'insurance', 'roadworthiness'] loop
    select vd.review_status, vd.expiry_date
    into v_document_status, v_expiry_date
    from public.vehicle_documents vd
    where vd.vehicle_id = p_vehicle_id and vd.document_type = v_document_type
    order by vd.uploaded_at desc
    limit 1;
    if not found
      or v_document_status <> 'approved'
      or (
        v_document_type in ('insurance', 'roadworthiness')
        and v_expiry_date < current_date
      ) then
      raise exception 'Approved registration and current approved insurance and roadworthiness documents are required.'
        using errcode = '23514';
    end if;
  end loop;

  if v_current_driver_id = p_driver_user_id then
    return v_current_assignment_id;
  end if;

  if v_current_assignment_id is not null then
    update public.vehicle_assignments
    set ended_at = greatest(clock_timestamp(), started_at + interval '1 microsecond')
    where id = v_current_assignment_id;
    perform public.write_audit_log(
      'vehicle.assignment_ended',
      v_current_driver_id,
      jsonb_build_object('vehicle_id', p_vehicle_id, 'assignment_id', v_current_assignment_id)
    );
  end if;

  select id, vehicle_id
  into v_driver_existing_assignment_id, v_driver_existing_vehicle_id
  from public.vehicle_assignments
  where driver_user_id = p_driver_user_id and ended_at is null
  for update;

  update public.vehicle_assignments
  set ended_at = greatest(clock_timestamp(), started_at + interval '1 microsecond')
  where driver_user_id = p_driver_user_id and ended_at is null;
  if v_driver_existing_assignment_id is not null then
    perform public.write_audit_log(
      'vehicle.assignment_ended',
      p_driver_user_id,
      jsonb_build_object(
        'vehicle_id', v_driver_existing_vehicle_id,
        'assignment_id', v_driver_existing_assignment_id,
        'reason', 'driver_reassigned'
      )
    );
  end if;

  insert into public.vehicle_assignments (vehicle_id, driver_user_id, assigned_by)
  values (p_vehicle_id, p_driver_user_id, auth.uid())
  returning id into v_assignment_id;

  perform public.write_audit_log(
    case when v_current_assignment_id is null
      then 'vehicle.assignment_created' else 'vehicle.assignment_reassigned' end,
    p_driver_user_id,
    jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'assignment_id', v_assignment_id,
      'previous_driver_user_id', v_current_driver_id
    )
  );
  return v_assignment_id;
end;
$$;

create or replace function public.create_vehicle_maintenance_record(
  p_vehicle_id uuid,
  p_service_type text,
  p_notes text,
  p_maintenance_date date,
  p_next_due_date date,
  p_status text default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id uuid;
  v_vehicle_status text;
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicle maintenance.' using errcode = '42501';
  end if;

  select status into v_vehicle_status
  from public.vehicles where id = p_vehicle_id for update;
  if not found then
    raise exception 'The vehicle was not found.' using errcode = 'P0002';
  end if;
  if p_status = 'in_progress' and v_vehicle_status = 'retired' then
    raise exception 'Retired vehicles cannot enter maintenance.' using errcode = '23514';
  end if;

  insert into public.vehicle_maintenance_records (
    vehicle_id, service_type, notes, maintenance_date, next_due_date,
    status, created_by, updated_by
  ) values (
    p_vehicle_id, btrim(p_service_type), coalesce(p_notes, ''),
    p_maintenance_date, p_next_due_date, p_status, auth.uid(), auth.uid()
  )
  returning id into v_record_id;

  if p_status = 'in_progress' and v_vehicle_status = 'active' then
    update public.vehicles set status = 'maintenance', updated_by = auth.uid()
    where id = p_vehicle_id;
    update public.vehicle_assignments
    set ended_at = greatest(clock_timestamp(), started_at + interval '1 microsecond')
    where vehicle_id = p_vehicle_id and ended_at is null;
  end if;

  perform public.write_audit_log(
    'vehicle.maintenance_created',
    null,
    jsonb_build_object('vehicle_id', p_vehicle_id, 'maintenance_record_id', v_record_id)
  );
  return v_record_id;
end;
$$;

create or replace function public.update_vehicle_maintenance_record(
  p_record_id uuid,
  p_status text,
  p_next_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_maintenance_date date;
  v_vehicle_status text;
begin
  if auth.uid() is null or not public.current_user_has_permission('vehicles.manage') then
    raise exception 'You do not have permission to manage vehicle maintenance.' using errcode = '42501';
  end if;

  select vehicle_id, maintenance_date
  into v_vehicle_id, v_maintenance_date
  from public.vehicle_maintenance_records
  where id = p_record_id
  for update;
  if not found then
    raise exception 'The maintenance record was not found.' using errcode = 'P0002';
  end if;
  select status into v_vehicle_status from public.vehicles where id = v_vehicle_id;
  if p_status = 'in_progress' and v_vehicle_status = 'retired' then
    raise exception 'Retired vehicles cannot enter maintenance.' using errcode = '23514';
  end if;
  if p_next_due_date is not null and p_next_due_date < v_maintenance_date then
    raise exception 'The next due date cannot be before the maintenance date.'
      using errcode = '23514';
  end if;

  update public.vehicle_maintenance_records
  set status = p_status, next_due_date = p_next_due_date, updated_by = auth.uid()
  where id = p_record_id;

  if p_status = 'in_progress' and v_vehicle_status = 'active' then
    update public.vehicles set status = 'maintenance', updated_by = auth.uid()
    where id = v_vehicle_id;
    update public.vehicle_assignments
    set ended_at = greatest(clock_timestamp(), started_at + interval '1 microsecond')
    where vehicle_id = v_vehicle_id and ended_at is null;
  end if;

  perform public.write_audit_log(
    'vehicle.maintenance_updated',
    null,
    jsonb_build_object('vehicle_id', v_vehicle_id, 'maintenance_record_id', p_record_id, 'status', p_status)
  );
end;
$$;

create or replace function public.get_my_assigned_vehicle_summary()
returns table (
  vehicle_id uuid,
  registration_number text,
  vehicle_type text,
  make text,
  model text,
  model_year integer,
  seating_capacity integer,
  vehicle_status text,
  document_type text,
  expiry_date date,
  document_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with assigned_vehicle as (
    select v.*
    from public.vehicle_assignments va
    join public.vehicles v on v.id = va.vehicle_id
    where va.driver_user_id = auth.uid()
      and va.ended_at is null
    limit 1
  ),
  required_documents as (
    select unnest(array['registration', 'insurance', 'roadworthiness']::text[]) as document_type
  )
  select
    av.id,
    av.registration_number,
    av.vehicle_type,
    av.make,
    av.model,
    av.model_year,
    av.seating_capacity,
    av.status,
    rd.document_type,
    latest.expiry_date,
    case
      when latest.id is null then 'missing'
      when latest.expiry_date is not null and latest.expiry_date < current_date then 'expired'
      else latest.review_status
    end
  from assigned_vehicle av
  cross join required_documents rd
  left join lateral (
    select vd.id, vd.expiry_date, vd.review_status
    from public.vehicle_documents vd
    where vd.vehicle_id = av.id and vd.document_type = rd.document_type
    order by vd.uploaded_at desc
    limit 1
  ) latest on true;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-documents',
  'vehicle-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sureseat_private_buckets_select_guard on storage.objects;
create policy sureseat_private_buckets_select_guard
on storage.objects as restrictive for select to public
using (
  bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos', 'vehicle-documents')
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
      or (
        bucket_id = 'vehicle-documents'
        and public.current_user_has_permission('vehicles.manage')
        and exists (
          select 1 from public.vehicles v
          where v.id::text = (storage.foldername(name))[1]
        )
      )
    )
  )
);

drop policy if exists sureseat_private_buckets_insert_guard on storage.objects;
create policy sureseat_private_buckets_insert_guard
on storage.objects as restrictive for insert to public
with check (
  bucket_id not in ('identity-documents', 'driver-documents', 'profile-photos', 'vehicle-documents')
  or (
    auth.role() = 'authenticated'
    and (
      (
        bucket_id in ('identity-documents', 'driver-documents', 'profile-photos')
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      or (
        bucket_id = 'vehicle-documents'
        and public.current_user_has_permission('vehicles.manage')
        and exists (
          select 1 from public.vehicles v
          where v.id::text = (storage.foldername(name))[1]
        )
      )
    )
  )
);

create policy vehicle_documents_storage_read_manager
on storage.objects for select to authenticated
using (
  bucket_id = 'vehicle-documents'
  and public.current_user_has_permission('vehicles.manage')
  and exists (
    select 1 from public.vehicles v
    where v.id::text = (storage.foldername(name))[1]
  )
);

create policy vehicle_documents_storage_insert_manager
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vehicle-documents'
  and public.current_user_has_permission('vehicles.manage')
  and exists (
    select 1 from public.vehicles v
    where v.id::text = (storage.foldername(name))[1]
  )
);

create policy vehicle_documents_storage_update_manager
on storage.objects for update to authenticated
using (
  bucket_id = 'vehicle-documents'
  and public.current_user_has_permission('vehicles.manage')
)
with check (
  bucket_id = 'vehicle-documents'
  and public.current_user_has_permission('vehicles.manage')
);

create policy vehicle_documents_storage_delete_manager
on storage.objects for delete to authenticated
using (
  bucket_id = 'vehicle-documents'
  and public.current_user_has_permission('vehicles.manage')
);

revoke all on function public.create_vehicle(text, text, text, text, integer, integer, text)
  from public, anon;
revoke all on function public.update_vehicle(uuid, text, text, text, text, integer, integer, text)
  from public, anon;
revoke all on function public.create_vehicle_document(uuid, text, text, text, text, bigint, date)
  from public, anon;
revoke all on function public.review_vehicle_document(uuid, boolean)
  from public, anon;
revoke all on function public.list_eligible_vehicle_drivers()
  from public, anon;
revoke all on function public.get_vehicle_assignment_history(uuid)
  from public, anon;
revoke all on function public.set_vehicle_assignment(uuid, uuid)
  from public, anon;
revoke all on function public.create_vehicle_maintenance_record(uuid, text, text, date, date, text)
  from public, anon;
revoke all on function public.update_vehicle_maintenance_record(uuid, text, date)
  from public, anon;
revoke all on function public.get_my_assigned_vehicle_summary()
  from public, anon;

grant execute on function public.create_vehicle(text, text, text, text, integer, integer, text)
  to authenticated;
grant execute on function public.update_vehicle(uuid, text, text, text, text, integer, integer, text)
  to authenticated;
grant execute on function public.create_vehicle_document(uuid, text, text, text, text, bigint, date)
  to authenticated;
grant execute on function public.review_vehicle_document(uuid, boolean)
  to authenticated;
grant execute on function public.list_eligible_vehicle_drivers()
  to authenticated;
grant execute on function public.get_vehicle_assignment_history(uuid)
  to authenticated;
grant execute on function public.set_vehicle_assignment(uuid, uuid)
  to authenticated;
grant execute on function public.create_vehicle_maintenance_record(uuid, text, text, date, date, text)
  to authenticated;
grant execute on function public.update_vehicle_maintenance_record(uuid, text, date)
  to authenticated;
grant execute on function public.get_my_assigned_vehicle_summary()
  to authenticated;

commit;
