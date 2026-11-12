-- Driver-scoped departure boarding, trip start, and passenger manifest access.

begin;

create or replace function public.list_my_transport_departures()
returns table (
  departure_id uuid,
  route_id uuid,
  route_name text,
  route_via text,
  travel_date date,
  departure_time time,
  status text,
  capacity integer,
  vehicle_registration text,
  vehicle_type text,
  confirmed_passengers integer,
  boarded_passengers integer,
  completion_requests integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_role('driver') then
    raise exception 'An authorized driver account is required.' using errcode = '42501';
  end if;

  return query
  select d.id, d.route_id, r.name, r.via, d.travel_date, d.departure_time,
         d.status, d.capacity, v.registration_number, v.vehicle_type,
         (count(b.id) filter (where b.status in ('confirmed', 'completed')))::integer,
         (count(b.id) filter (where b.journey_status in ('boarded', 'completion_requested', 'completed')))::integer,
         (count(b.id) filter (where b.journey_status = 'completion_requested'))::integer
  from public.transport_departures d
  join public.transport_routes r on r.id = d.route_id
  join public.vehicles v on v.id = d.vehicle_id
  left join public.transport_bookings b on b.departure_id = d.id
    and b.status in ('confirmed', 'completed')
  where d.driver_user_id = auth.uid()
    and d.status in ('scheduled', 'boarding', 'in_progress', 'completed')
    and (d.travel_date >= current_date or d.status = 'in_progress')
  group by d.id, r.id, v.id
  order by d.travel_date, d.departure_time;
end;
$$;

create or replace function public.list_transport_departure_manifest(p_departure_id uuid)
returns table (
  booking_id uuid,
  passenger_name text,
  pickup_stop text,
  dropoff_stop text,
  booking_status text,
  journey_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_role('driver')
     or not public.current_user_is_transport_departure_driver(p_departure_id) then
    raise exception 'Only the assigned driver can view this passenger manifest.' using errcode = '42501';
  end if;

  return query
  select b.id, coalesce(nullif(btrim(p.full_name), ''), 'Passenger'),
         pickup.stop_name, dropoff.stop_name, b.status, b.journey_status
  from public.transport_bookings b
  join public.transport_departures d on d.id = b.departure_id
  join public.profiles p on p.id = b.passenger_user_id
  join public.transport_route_stops pickup
    on pickup.route_id = d.route_id
    and pickup.stop_index = b.pickup_stop_index
  join public.transport_route_stops dropoff
    on dropoff.route_id = d.route_id
    and dropoff.stop_index = b.dropoff_stop_index
  where b.departure_id = p_departure_id
    and b.status in ('confirmed', 'completed')
  order by b.pickup_stop_index, b.dropoff_stop_index, b.created_at;
end;
$$;

create or replace function public.driver_begin_transport_boarding(p_departure_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null or not public.current_user_has_role('driver') then
    raise exception 'An authorized driver account is required.' using errcode = '42501';
  end if;

  select d.status into v_status
  from public.transport_departures d
  where d.id = p_departure_id and d.driver_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Assigned departure not found.' using errcode = 'P0002';
  end if;
  if v_status = 'boarding' then return; end if;
  if v_status <> 'scheduled' then
    raise exception 'Only a scheduled departure can open boarding.' using errcode = '23514';
  end if;

  update public.transport_departures set status = 'boarding' where id = p_departure_id;
  perform public.write_audit_log(
    'transport_departure.boarding_opened', auth.uid(),
    jsonb_build_object('departure_id', p_departure_id)
  );
end;
$$;

create or replace function public.driver_start_transport_departure(p_departure_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure public.transport_departures%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_role('driver') then
    raise exception 'An authorized driver account is required.' using errcode = '42501';
  end if;

  select * into v_departure
  from public.transport_departures d
  where d.id = p_departure_id and d.driver_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Assigned departure not found.' using errcode = 'P0002';
  end if;
  if v_departure.status = 'in_progress' then return; end if;
  if v_departure.status <> 'boarding' then
    raise exception 'Open boarding before starting this trip.' using errcode = '23514';
  end if;
  if v_departure.travel_date > current_date
     or (v_departure.travel_date = current_date and v_departure.departure_time > localtime) then
    raise exception 'This departure cannot start before its scheduled time.' using errcode = '23514';
  end if;

  update public.transport_departures set status = 'in_progress' where id = p_departure_id;
  perform public.write_audit_log(
    'transport_departure.started', auth.uid(),
    jsonb_build_object('departure_id', p_departure_id, 'travel_date', v_departure.travel_date,
      'departure_time', v_departure.departure_time)
  );
end;
$$;

-- Keep the public RPC signature but require boarding to be explicitly opened
-- before a driver can validate passenger codes.
create or replace function public.verify_transport_booking_code(p_booking_code text)
returns table (
  booking_id uuid,
  departure_id uuid,
  passenger_user_id uuid,
  journey_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_departure_id uuid;
  v_passenger_id uuid;
  v_journey_status text;
begin
  if auth.uid() is null or not public.current_user_has_role('driver') then
    raise exception 'An authorized driver account is required.' using errcode = '42501';
  end if;

  update public.transport_bookings b
  set journey_status = 'boarded', boarded_at = now()
  from public.transport_departures d
  where b.departure_id = d.id
    and d.driver_user_id = auth.uid()
    and b.booking_code = upper(btrim(p_booking_code))
    and b.status = 'confirmed'
    and b.journey_status = 'not_boarded'
    and d.status in ('boarding', 'in_progress')
  returning b.id, b.departure_id, b.passenger_user_id, b.journey_status
  into v_booking_id, v_departure_id, v_passenger_id, v_journey_status;

  if v_booking_id is null then
    raise exception 'Booking code is invalid, already used, or not assigned to your boarding departure.'
      using errcode = 'P0002';
  end if;

  insert into public.transport_events(booking_id, departure_id, actor_user_id, event_type)
  values (v_booking_id, v_departure_id, auth.uid(), 'boarding_verified');

  return query select v_booking_id, v_departure_id, v_passenger_id, v_journey_status;
end;
$$;

revoke all on function public.list_my_transport_departures() from public, anon;
revoke all on function public.list_transport_departure_manifest(uuid) from public, anon;
revoke all on function public.driver_begin_transport_boarding(uuid) from public, anon;
revoke all on function public.driver_start_transport_departure(uuid) from public, anon;
revoke all on function public.verify_transport_booking_code(text) from public, anon;

grant execute on function public.list_my_transport_departures() to authenticated;
grant execute on function public.list_transport_departure_manifest(uuid) to authenticated;
grant execute on function public.driver_begin_transport_boarding(uuid) to authenticated;
grant execute on function public.driver_start_transport_departure(uuid) to authenticated;
grant execute on function public.verify_transport_booking_code(text) to authenticated;

commit;
