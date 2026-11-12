begin;

create function public.admin_get_transport_person_detail(
  p_target_user_id uuid,
  p_role text
)
returns table (
  user_id uuid,
  user_email text,
  full_name text,
  phone text,
  account_status text,
  created_at timestamptz,
  identity_verified_at timestamptz,
  driver_application_status text,
  vehicle_type text,
  vehicle_registration_number text,
  experience_years integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_target_user_id is null or p_role is null or p_role not in ('passenger', 'driver', 'staff') then
    raise exception 'Choose a valid account and directory.' using errcode = '22023';
  end if;
  if p_role = 'passenger' and not (
    public.current_user_has_role('administrator') or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('passengers.read') or public.current_user_has_permission('support.manage')
  ) then raise exception 'Passenger details are not authorized.' using errcode = '42501'; end if;
  if p_role = 'driver' and not (
    public.current_user_has_role('administrator') or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('drivers.read') or public.current_user_has_permission('drivers.approve')
    or public.current_user_has_permission('support.manage')
  ) then raise exception 'Driver details are not authorized.' using errcode = '42501'; end if;
  if p_role = 'staff' and not (
    public.current_user_has_role('administrator') or public.current_user_has_role('super_admin')
  ) then raise exception 'Staff details are restricted to administrators.' using errcode = '42501'; end if;

  return query
  select p.id, u.email, p.full_name, p.phone, p.account_status, p.created_at,
    p.identity_verified_at, da.status, da.vehicle_type, da.vehicle_registration_number, da.experience_years
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select a.status, a.vehicle_type, a.vehicle_registration_number, a.experience_years
    from public.driver_applications a
    where p_role = 'driver' and a.user_id = p.id
    order by a.created_at desc
    limit 1
  ) da on true
  where p.id = p_target_user_id
    and (
      exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = p_role)
      or (p_role = 'driver' and exists (select 1 from public.driver_applications a where a.user_id = p.id))
    );
  if not found then raise exception 'Account not found in this directory.' using errcode = 'P0002'; end if;
end;
$$;

create function public.admin_update_person_contact(
  p_target_user_id uuid,
  p_role text,
  p_full_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_name text;
  v_old_phone text;
  v_full_name text := nullif(btrim(p_full_name), '');
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '28000'; end if;
  if p_target_user_id is null or p_role is null or p_role not in ('passenger', 'driver', 'staff') then
    raise exception 'Choose a valid account and directory.' using errcode = '22023';
  end if;
  if v_full_name is null or length(v_full_name) > 120 or length(coalesce(v_phone, '')) > 30 then
    raise exception 'Enter a name up to 120 characters and a phone number up to 30 characters.' using errcode = '22023';
  end if;
  if p_role = 'staff' then
    if not (public.current_user_has_role('administrator') or public.current_user_has_role('super_admin')) then
      raise exception 'Only administrators can edit staff contact details.' using errcode = '42501';
    end if;
  elsif not (
    public.current_user_has_role('administrator') or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('support.manage')
  ) then
    raise exception 'Profile editing is not authorized.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_target_user_id
      and (
        exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = p_role)
        or (p_role = 'driver' and exists (select 1 from public.driver_applications a where a.user_id = p.id))
      )
  ) then raise exception 'Account not found in this directory.' using errcode = 'P0002'; end if;

  select full_name, phone into v_old_name, v_old_phone
  from public.profiles where id = p_target_user_id for update;
  update public.profiles set full_name = v_full_name, phone = v_phone where id = p_target_user_id;
  perform public.write_audit_log(
    'support.person_contact_updated', p_target_user_id,
    jsonb_build_object('role', p_role, 'old_name', v_old_name, 'new_name', v_full_name,
      'old_phone', v_old_phone, 'new_phone', v_phone)
  );
end;
$$;

revoke all on function public.admin_get_transport_person_detail(uuid, text) from public, anon;
revoke all on function public.admin_update_person_contact(uuid, text, text, text) from public, anon;
grant execute on function public.admin_get_transport_person_detail(uuid, text) to authenticated;
grant execute on function public.admin_update_person_contact(uuid, text, text, text) to authenticated;

commit;
