begin;

-- Expose only the directory fields needed for authorized passenger/driver support.
-- Driver-read staff must not receive general access to the profiles table.
create function public.admin_list_transport_people(p_role text)
returns table (
  user_id uuid,
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
  if p_role is null or p_role not in ('passenger', 'driver') then
    raise exception 'Choose a supported directory.' using errcode = '22023';
  end if;
  if p_role = 'passenger' and not (
    public.current_user_has_role('administrator')
    or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('passengers.read')
  ) then
    raise exception 'Passenger directory access is not authorized.' using errcode = '42501';
  end if;
  if p_role = 'driver' and not (
    public.current_user_has_role('administrator')
    or public.current_user_has_role('super_admin')
    or public.current_user_has_permission('drivers.read')
    or public.current_user_has_permission('drivers.approve')
  ) then
    raise exception 'Driver directory access is not authorized.' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, p.phone, p.account_status, p.created_at,
    p.identity_verified_at, da.status, da.vehicle_type,
    da.vehicle_registration_number, da.experience_years
  from public.profiles p
  left join lateral (
    select a.status, a.vehicle_type, a.vehicle_registration_number, a.experience_years
    from public.driver_applications a
    where p_role = 'driver' and a.user_id = p.id
    order by a.created_at desc
    limit 1
  ) da on true
  where exists (
    select 1 from public.user_roles ur
    where ur.user_id = p.id and ur.role = p_role
  ) or (
    p_role = 'driver' and exists (
      select 1 from public.driver_applications applicant
      where applicant.user_id = p.id
    )
  )
  order by p.created_at desc
  limit 500;
end;
$$;

revoke all on function public.admin_list_transport_people(text) from public, anon;
grant execute on function public.admin_list_transport_people(text) to authenticated;

commit;
