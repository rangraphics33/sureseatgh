-- Admin scheduling for shared transport departures.
-- Reuses vehicles, vehicle assignments, approved driver records, and route tables.

begin;

drop policy if exists transport_departures_read_participant_or_manager
  on public.transport_departures;
create policy transport_departures_read_participant_or_manager
on public.transport_departures for select to authenticated
using (
  public.current_user_has_permission('bookings.read')
  or public.current_user_has_permission('routes.manage')
  or public.current_user_is_transport_departure_participant(id)
);

create or replace function public.list_transport_departure_assignments()
returns table (
  vehicle_id uuid,
  registration_number text,
  seating_capacity integer,
  driver_user_id uuid,
  driver_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('routes.manage') then
    raise exception 'You do not have permission to schedule departures.' using errcode = '42501';
  end if;

  return query
  select v.id, v.registration_number, v.seating_capacity,
         p.id, coalesce(p.full_name, 'Driver account')
  from public.vehicle_assignments va
  join public.vehicles v on v.id = va.vehicle_id and v.status = 'active'
  join public.profiles p on p.id = va.driver_user_id and p.account_status = 'active'
  join public.user_roles ur on ur.user_id = va.driver_user_id and ur.role = 'driver'
  join public.driver_applications da on da.user_id = va.driver_user_id and da.status = 'approved'
  where va.ended_at is null
    and not exists (
      select 1 from unnest(array['registration', 'insurance', 'roadworthiness']::text[]) as required(document_type)
      where not exists (
        select 1 from public.vehicle_documents vd
        where vd.vehicle_id = v.id
          and vd.document_type = required.document_type
          and vd.review_status = 'approved'
          and (vd.document_type = 'registration' or vd.expiry_date >= current_date)
          and not exists (
            select 1 from public.vehicle_documents newer
            where newer.vehicle_id = vd.vehicle_id
              and newer.document_type = vd.document_type
              and newer.uploaded_at > vd.uploaded_at
          )
      )
    )
  order by p.full_name, v.registration_number;
end;
$$;

create or replace function public.admin_save_transport_departure(
  p_departure_id uuid,
  p_route_id uuid,
  p_travel_date date,
  p_departure_time time,
  p_driver_user_id uuid,
  p_vehicle_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure_id uuid;
  v_capacity integer;
  v_status text;
  v_has_bookings boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not public.current_user_has_permission('routes.manage') then
    raise exception 'You do not have permission to schedule departures.' using errcode = '42501';
  end if;
  if p_route_id is null or p_travel_date is null or p_departure_time is null
     or p_driver_user_id is null or p_vehicle_id is null then
    raise exception 'Route, date, time, driver, and vehicle are required.' using errcode = '22023';
  end if;
  if p_travel_date < current_date
     or (p_travel_date = current_date and p_departure_time <= localtime) then
    raise exception 'A departure must be scheduled in the future.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.transport_routes r
    where r.id = p_route_id and r.status = 'published'
  ) then
    raise exception 'Select a published route.' using errcode = '23514';
  end if;

  select v.seating_capacity into v_capacity
  from public.vehicle_assignments va
  join public.vehicles v on v.id = va.vehicle_id and v.status = 'active'
  join public.user_roles ur on ur.user_id = va.driver_user_id and ur.role = 'driver'
  join public.driver_applications da on da.user_id = va.driver_user_id and da.status = 'approved'
  join public.profiles p on p.id = va.driver_user_id and p.account_status = 'active'
  where v.id = p_vehicle_id and va.driver_user_id = p_driver_user_id and va.ended_at is null
    and not exists (
      select 1 from unnest(array['registration', 'insurance', 'roadworthiness']::text[]) as required(document_type)
      where not exists (
        select 1 from public.vehicle_documents vd
        where vd.vehicle_id = v.id and vd.document_type = required.document_type
          and vd.review_status = 'approved'
          and (vd.document_type = 'registration' or vd.expiry_date >= p_travel_date)
          and not exists (
            select 1 from public.vehicle_documents newer
            where newer.vehicle_id = vd.vehicle_id
              and newer.document_type = vd.document_type
              and newer.uploaded_at > vd.uploaded_at
          )
      )
    );
  if not found then
    raise exception 'The driver and active vehicle must be currently assigned, approved, and have current approved documents through the departure date.'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('sureseat-transport-departures')::bigint);
  if exists (
    select 1 from public.transport_departures d
    where d.travel_date = p_travel_date and d.departure_time = p_departure_time
      and d.status in ('scheduled', 'boarding', 'in_progress')
      and (d.driver_user_id = p_driver_user_id or d.vehicle_id = p_vehicle_id)
      and (p_departure_id is null or d.id <> p_departure_id)
  ) then
    raise exception 'The selected driver or vehicle already has a departure at that date and time.'
      using errcode = '23505';
  end if;

  if p_departure_id is null then
    insert into public.transport_departures(
      route_id, travel_date, departure_time, driver_user_id, vehicle_id,
      status, capacity, created_by
    ) values (
      p_route_id, p_travel_date, p_departure_time, p_driver_user_id, p_vehicle_id,
      'scheduled', v_capacity, auth.uid()
    ) returning id into v_departure_id;
  else
    select d.status, exists(select 1 from public.transport_bookings b where b.departure_id = d.id)
    into v_status, v_has_bookings
    from public.transport_departures d
    where d.id = p_departure_id
    for update;
    if not found then
      raise exception 'Departure not found.' using errcode = 'P0002';
    end if;
    if v_status <> 'scheduled' or v_has_bookings then
      raise exception 'Only scheduled departures without bookings can be changed.' using errcode = '23514';
    end if;
    update public.transport_departures
    set route_id = p_route_id, travel_date = p_travel_date, departure_time = p_departure_time,
        driver_user_id = p_driver_user_id, vehicle_id = p_vehicle_id, capacity = v_capacity
    where id = p_departure_id
    returning id into v_departure_id;
  end if;

  perform public.write_audit_log(
    case when p_departure_id is null then 'transport_departure.scheduled' else 'transport_departure.updated' end,
    p_driver_user_id,
    jsonb_build_object('departure_id', v_departure_id, 'route_id', p_route_id,
      'vehicle_id', p_vehicle_id, 'travel_date', p_travel_date, 'departure_time', p_departure_time)
  );
  return v_departure_id;
end;
$$;

revoke all on function public.list_transport_departure_assignments() from public, anon;
revoke all on function public.admin_save_transport_departure(uuid, uuid, date, time, uuid, uuid) from public, anon;
grant execute on function public.list_transport_departure_assignments() to authenticated;
grant execute on function public.admin_save_transport_departure(uuid, uuid, date, time, uuid, uuid) to authenticated;

commit;
