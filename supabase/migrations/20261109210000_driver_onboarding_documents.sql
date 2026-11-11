begin;

alter table public.driver_applications
  add column if not exists vehicle_registration_number text;

grant insert (vehicle_registration_number)
  on public.driver_applications to authenticated;

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf', 'image/webp']
where id = 'driver-documents';

create table if not exists public.driver_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.driver_applications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  document_type text not null check (document_type in (
    'ghana_card', 'drivers_license', 'vehicle_registration', 'insurance', 'driver_photo'
  )),
  object_path text not null check (object_path !~ '^/'),
  created_at timestamptz not null default now(),
  unique (application_id, document_type),
  check (object_path like (user_id::text || '/%'))
);

create index if not exists driver_application_documents_application_idx
  on public.driver_application_documents (application_id);

alter table public.driver_application_documents enable row level security;

grant select on public.driver_application_documents to authenticated;
grant insert (application_id, user_id, document_type, object_path)
  on public.driver_application_documents to authenticated;

drop policy if exists driver_applications_read_own_or_admin
  on public.driver_applications;
create policy driver_applications_read_own_or_authorized
on public.driver_applications for select to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_role('administrator')
  or public.current_user_has_role('super_admin')
  or public.current_user_has_permission('drivers.read')
  or public.current_user_has_permission('drivers.approve')
);

create policy driver_application_documents_read_owner_or_reviewer
on public.driver_application_documents for select to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_permission('drivers.approve')
);

create policy driver_application_documents_insert_owner
on public.driver_application_documents for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.driver_applications da
    where da.id = application_id
      and da.user_id = auth.uid()
      and da.status = 'pending'
  )
  and object_path like (auth.uid()::text || '/%')
);

create or replace function public.review_driver_application(
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
    or public.current_user_has_permission('drivers.approve')
  ) then
    raise exception 'You do not have permission to review driver applications.'
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

  if p_approved and (
    select count(distinct document_type)
    from public.driver_application_documents
    where application_id = p_application_id
      and user_id = v_user_id
  ) <> 5 then
    raise exception 'All five required driver documents must be submitted before approval.'
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

grant execute on function public.review_driver_application(uuid, boolean)
  to authenticated;

commit;
