-- Allow administrators to safely change a scheduled departure's time/assignment
-- after bookings exist. The route and passenger journeys remain unchanged.

begin;

create function public.admin_reschedule_transport_departure(
  p_departure_id uuid,
  p_travel_date date,
  p_departure_time time,
  p_driver_user_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure public.transport_departures%rowtype;
  v_capacity integer;
  v_now timestamptz := now();
  v_peak_occupancy integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not public.current_user_has_permission('routes.manage') then
    raise exception 'You do not have permission to reschedule departures.' using errcode = '42501';
  end if;
  if p_departure_id is null or p_travel_date is null or p_departure_time is null
     or p_driver_user_id is null or p_vehicle_id is null then
    raise exception 'Departure, date, time, driver, and vehicle are required.' using errcode = '22023';
  end if;
  if p_travel_date < current_date
     or (p_travel_date = current_date and p_departure_time <= localtime) then
    raise exception 'A departure must be scheduled in the future.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('sureseat-transport-departures')::bigint);
  select * into v_departure
  from public.transport_departures d
  where d.id = p_departure_id
  for update;
  if not found then
    raise exception 'Departure not found.' using errcode = 'P0002';
  end if;
  if v_departure.status <> 'scheduled' then
    raise exception 'Only scheduled departures can be rescheduled.' using errcode = '23514';
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
    raise exception 'The driver and active vehicle must be currently assigned, approved, and have current approved documents through the new departure date.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.transport_departures d
    where d.travel_date = p_travel_date and d.departure_time = p_departure_time
      and d.status in ('scheduled', 'boarding', 'in_progress')
      and (d.driver_user_id = p_driver_user_id or d.vehicle_id = p_vehicle_id)
      and d.id <> p_departure_id
  ) then
    raise exception 'The selected driver or vehicle already has a departure at that date and time.'
      using errcode = '23505';
  end if;

  update public.transport_bookings b
  set status = 'expired'
  where b.departure_id = p_departure_id
    and b.status = 'pending_payment'
    and b.hold_expires_at <= v_now;

  select coalesce(max(occupancy.seats), 0)::integer into v_peak_occupancy
  from (
    select count(b.id)::integer as seats
    from generate_series(0, greatest(
      (select coalesce(max(s.stop_index), 0) from public.transport_route_stops s where s.route_id = v_departure.route_id) - 1,
      0
    )) as segment(stop_index)
    left join public.transport_bookings b on b.departure_id = p_departure_id
        and b.pickup_stop_index <= segment.stop_index
        and b.dropoff_stop_index > segment.stop_index
        and (b.status = 'confirmed'
          or (b.status = 'pending_payment' and b.hold_expires_at > v_now))
    group by segment.stop_index
  ) occupancy;

  if v_capacity < v_peak_occupancy then
    raise exception 'The selected vehicle has % seats, but this departure needs at least % seats on its busiest segment.',
      v_capacity, v_peak_occupancy
      using errcode = '23514', detail = jsonb_build_object('capacity', v_capacity, 'peak_occupancy', v_peak_occupancy)::text;
  end if;

  update public.transport_departures
  set travel_date = p_travel_date,
      departure_time = p_departure_time,
      driver_user_id = p_driver_user_id,
      vehicle_id = p_vehicle_id,
      capacity = v_capacity
  where id = p_departure_id;

  perform public.write_audit_log(
    'transport_departure.rescheduled', p_driver_user_id,
    jsonb_build_object('departure_id', p_departure_id, 'route_id', v_departure.route_id,
      'previous_travel_date', v_departure.travel_date,
      'previous_departure_time', v_departure.departure_time,
      'travel_date', p_travel_date, 'departure_time', p_departure_time,
      'vehicle_id', p_vehicle_id, 'capacity', v_capacity)
  );
end;
$$;

revoke all on function public.admin_reschedule_transport_departure(uuid, date, time, uuid, uuid) from public, anon;
grant execute on function public.admin_reschedule_transport_departure(uuid, date, time, uuid, uuid) to authenticated;

commit;
