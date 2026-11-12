-- Switch transport fares from per-segment amounts to one standard fare per route.
-- The existing full_route_fare column is retained for database/API compatibility;
-- its value now represents the standard one-way route fare.

begin;

-- Previous full_route_fare values were totals derived from segment prices. Do not
-- silently reuse those totals as the new price for every partial journey.
update public.transport_routes
set status = case when status = 'published' then 'draft' else status end,
    full_route_fare = 0;

create or replace function public.admin_save_transport_route(
  p_route_id uuid,
  p_name text,
  p_via text,
  p_full_route_fare numeric,
  p_stops text[],
  p_segment_fares numeric[],
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route_id uuid;
  v_old_status text;
  v_old_fare numeric(10,2);
  v_stop_count integer;
  v_existing_stops text[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not public.current_user_has_permission('routes.manage') then
    raise exception 'You are not authorized to manage routes.' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 120
     or p_via is null or length(btrim(p_via)) > 120
     or p_full_route_fare is null or p_full_route_fare < 0
     or p_full_route_fare > 99999999.99
     or p_full_route_fare <> round(p_full_route_fare, 2)
     or p_stops is null then
    raise exception 'Route name, via, standard fare, or stops are invalid.'
      using errcode = '22023';
  end if;

  v_stop_count := coalesce(array_length(p_stops, 1), 0);
  if v_stop_count > 200
     or exists (
       select 1 from unnest(p_stops) as x(stop_name)
       where stop_name is null or length(btrim(stop_name)) not between 1 and 120
     ) then
    raise exception 'Route stops are invalid.' using errcode = '22023';
  end if;
  if p_publish and (v_stop_count < 2 or p_full_route_fare <= 0) then
    raise exception 'A published route needs at least two stops and a standard fare greater than zero.'
      using errcode = '23514';
  end if;

  if p_route_id is null then
    insert into public.transport_routes(name, via, status, full_route_fare, created_by, updated_by)
    values (btrim(p_name), btrim(p_via), 'draft', p_full_route_fare, auth.uid(), auth.uid())
    returning id into v_route_id;
    v_existing_stops := array[]::text[];
  else
    select status, full_route_fare into v_old_status, v_old_fare
    from public.transport_routes
    where id = p_route_id
    for update;
    if not found then
      raise exception 'Route not found.' using errcode = 'P0002';
    end if;
    v_route_id := p_route_id;

    if v_old_fare is distinct from p_full_route_fare and exists (
      select 1 from public.transport_departures d
      where d.route_id = v_route_id
        and (d.status in ('scheduled', 'boarding', 'in_progress')
          or exists (select 1 from public.transport_bookings b where b.departure_id = d.id))
    ) then
      raise exception 'The standard fare cannot change after departures or bookings depend on this route. Create a new route version.'
        using errcode = '23514';
    end if;

    select array_agg(s.stop_name order by s.stop_index) into v_existing_stops
    from public.transport_route_stops s where s.route_id = v_route_id;

    update public.transport_routes
    set name = btrim(p_name), via = btrim(p_via),
        full_route_fare = p_full_route_fare,
        status = case when p_publish then 'published' else 'draft' end,
        updated_by = auth.uid()
    where id = v_route_id;
  end if;

  -- Keep existing stop rows untouched on fare-only edits. The route guard makes
  -- stops immutable once a departure or booking depends on them.
  if coalesce(v_existing_stops, array[]::text[]) is distinct from p_stops then
    delete from public.transport_route_stops where route_id = v_route_id;
    insert into public.transport_route_stops(route_id, stop_index, stop_name)
    select v_route_id, ordinality::integer - 1, btrim(stop_name)
    from unnest(p_stops) with ordinality as stops(stop_name, ordinality);
  end if;

  -- p_segment_fares remains in the RPC signature for client compatibility.
  -- Segment fare rows are retained for historical compatibility and are no
  -- longer read, written, or used to publish or price a route.
  perform public.write_audit_log(
    case when p_publish then 'transport_route.published'
         when p_route_id is null then 'transport_route.created'
         else 'transport_route.updated' end,
    null,
    jsonb_build_object('route_id', v_route_id, 'previous_status', v_old_status,
      'status', case when p_publish then 'published' else 'draft' end,
      'stop_count', v_stop_count, 'standard_fare', p_full_route_fare)
  );
  return v_route_id;
end;
$$;

create or replace function public.search_available_transport_departures(
  p_route_id uuid,
  p_travel_date date,
  p_departure_window text,
  p_pickup_stop_index integer,
  p_dropoff_stop_index integer
)
returns table (
  departure_id uuid,
  departure_time time,
  vehicle text,
  driver text,
  available_seats integer,
  fare numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_account_can_create_bookings()
     or not public.current_user_has_role('passenger') then
    raise exception 'An eligible passenger account is required.' using errcode = '42501';
  end if;
  if p_departure_window not in ('Morning', 'Evening')
     or p_pickup_stop_index is null or p_dropoff_stop_index is null
     or p_pickup_stop_index < 0 or p_dropoff_stop_index <= p_pickup_stop_index then
    raise exception 'Choose a valid departure window and ordered route stops.' using errcode = '22023';
  end if;

  return query
  select d.id, d.departure_time, v.vehicle_type, 'Assigned driver'::text,
         capacity.available_seats, r.full_route_fare::numeric
  from public.transport_departures d
  join public.transport_routes r on r.id = d.route_id and r.status = 'published'
  join public.vehicles v on v.id = d.vehicle_id
  cross join lateral (
    select min(d.capacity - occupancy.occupied)::integer as available_seats
    from generate_series(p_pickup_stop_index, p_dropoff_stop_index - 1) as segment(stop_index)
    cross join lateral (
      select count(*)::integer as occupied
      from public.transport_bookings b
      where b.departure_id = d.id
        and b.pickup_stop_index <= segment.stop_index
        and b.dropoff_stop_index > segment.stop_index
        and (b.status = 'confirmed'
          or (b.status = 'pending_payment' and b.hold_expires_at > now()))
    ) occupancy
  ) capacity
  where d.route_id = p_route_id
    and d.travel_date = p_travel_date
    and d.status = 'scheduled'
    and (d.travel_date > current_date or d.departure_time > localtime)
    and ((p_departure_window = 'Morning' and d.departure_time < time '12:00')
      or (p_departure_window = 'Evening' and d.departure_time >= time '12:00'))
    and r.full_route_fare > 0
    and p_dropoff_stop_index < (
      select count(*) from public.transport_route_stops s where s.route_id = d.route_id
    )
    and exists (select 1 from public.transport_route_stops s
      where s.route_id = d.route_id and s.stop_index = p_pickup_stop_index)
    and exists (select 1 from public.transport_route_stops s
      where s.route_id = d.route_id and s.stop_index = p_dropoff_stop_index)
    and capacity.available_seats > 0
  order by d.departure_time;
end;
$$;

create or replace function public.create_transport_booking_hold(
  p_idempotency_key text,
  p_departure_id uuid,
  p_pickup_stop_index integer,
  p_dropoff_stop_index integer
)
returns table (
  booking_id uuid,
  booking_code text,
  status text,
  route_id uuid,
  route_name text,
  pickup text,
  dropoff text,
  travel_date date,
  departure_time time,
  departure_id uuid,
  vehicle text,
  driver text,
  fare numeric,
  created_at timestamptz,
  hold_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure public.transport_departures%rowtype;
  v_existing public.transport_bookings%rowtype;
  v_booking_id uuid;
  v_booking_code text;
  v_fare numeric(10,2);
  v_pickup text;
  v_dropoff text;
  v_available integer;
  v_now timestamptz;
begin
  if auth.uid() is null or not public.current_account_can_create_bookings()
     or not public.current_user_has_role('passenger') then
    raise exception 'An eligible passenger account is required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 8 and 200
     or p_departure_id is null or p_pickup_stop_index is null
     or p_dropoff_stop_index is null or p_pickup_stop_index < 0
     or p_dropoff_stop_index <= p_pickup_stop_index then
    raise exception 'Booking request details are invalid.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || btrim(p_idempotency_key), 0));
  v_now := clock_timestamp();
  select * into v_existing
  from public.transport_bookings b
  where b.passenger_user_id = auth.uid() and b.idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.departure_id <> p_departure_id
       or v_existing.pickup_stop_index <> p_pickup_stop_index
       or v_existing.dropoff_stop_index <> p_dropoff_stop_index then
      raise exception 'The idempotency key was already used for a different booking request.'
        using errcode = '23505';
    end if;
    if v_existing.status = 'pending_payment' and v_existing.hold_expires_at <= v_now then
      update public.transport_bookings b set status = 'expired'
      where b.id = v_existing.id returning b.* into v_existing;
    end if;
    booking_id := v_existing.id;
    booking_code := v_existing.booking_code;
    status := v_existing.status;
    select r.id, r.name, ps.stop_name, ds.stop_name, d.travel_date, d.departure_time,
           d.id, v.vehicle_type, 'Assigned driver'::text
    into route_id, route_name, pickup, dropoff, travel_date, departure_time,
         departure_id, vehicle, driver
    from public.transport_departures d
    join public.transport_routes r on r.id = d.route_id
    join public.vehicles v on v.id = d.vehicle_id
    join public.transport_route_stops ps on ps.route_id = d.route_id and ps.stop_index = v_existing.pickup_stop_index
    join public.transport_route_stops ds on ds.route_id = d.route_id and ds.stop_index = v_existing.dropoff_stop_index
    where d.id = v_existing.departure_id;
    fare := v_existing.fare;
    created_at := v_existing.created_at;
    hold_expires_at := v_existing.hold_expires_at;
    return next;
    return;
  end if;

  select * into v_departure
  from public.transport_departures d
  where d.id = p_departure_id
  for update;
  v_now := clock_timestamp();
  if not found or v_departure.status <> 'scheduled'
     or v_departure.travel_date < v_now::date
     or (v_departure.travel_date = v_now::date and v_departure.departure_time <= v_now::time) then
    raise exception 'This departure is no longer available for booking.' using errcode = 'P0002';
  end if;

  select r.full_route_fare into v_fare
  from public.transport_routes r
  where r.id = v_departure.route_id and r.status = 'published';
  if not found or v_fare is null or v_fare <= 0 then
    raise exception 'This route is not available for booking.' using errcode = '23514';
  end if;

  select s.stop_name into v_pickup from public.transport_route_stops s
  where s.route_id = v_departure.route_id and s.stop_index = p_pickup_stop_index;
  if not found then
    raise exception 'The pickup stop is not on this route.' using errcode = '22023';
  end if;
  select s.stop_name into v_dropoff from public.transport_route_stops s
  where s.route_id = v_departure.route_id and s.stop_index = p_dropoff_stop_index;
  if not found then
    raise exception 'The drop-off stop is not on this route.' using errcode = '22023';
  end if;

  update public.transport_bookings b
  set status = 'expired'
  where b.departure_id = v_departure.id
    and b.status = 'pending_payment'
    and b.hold_expires_at <= v_now;

  select min(v_departure.capacity - occupancy.occupied)::integer into v_available
  from generate_series(p_pickup_stop_index, p_dropoff_stop_index - 1) as segment(stop_index)
  cross join lateral (
    select count(*)::integer as occupied
    from public.transport_bookings b
    where b.departure_id = v_departure.id
      and b.pickup_stop_index <= segment.stop_index
      and b.dropoff_stop_index > segment.stop_index
      and (b.status = 'confirmed'
        or (b.status = 'pending_payment' and b.hold_expires_at > v_now))
  ) occupancy;
  if v_available is null or v_available <= 0 then
    raise exception 'There are no seats available for every segment of this journey.' using errcode = '23514';
  end if;

  v_booking_code := 'SS' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.transport_bookings(
    departure_id, passenger_user_id, booking_code, pickup_stop_index,
    dropoff_stop_index, fare, status, idempotency_key, created_at, hold_expires_at
  ) values (
    v_departure.id, auth.uid(), v_booking_code, p_pickup_stop_index,
    p_dropoff_stop_index, v_fare, 'pending_payment', btrim(p_idempotency_key), v_now, v_now + interval '10 minutes'
  ) returning id into v_booking_id;

  perform public.write_audit_log(
    'transport_booking.hold_created', auth.uid(),
    jsonb_build_object('booking_id', v_booking_id, 'departure_id', v_departure.id,
      'pickup_stop_index', p_pickup_stop_index, 'dropoff_stop_index', p_dropoff_stop_index, 'fare', v_fare)
  );

  booking_id := v_booking_id;
  booking_code := v_booking_code;
  status := 'pending_payment';
  route_id := v_departure.route_id;
  select r.name into route_name from public.transport_routes r where r.id = route_id;
  pickup := v_pickup;
  dropoff := v_dropoff;
  travel_date := v_departure.travel_date;
  departure_time := v_departure.departure_time;
  departure_id := v_departure.id;
  select v.vehicle_type into vehicle from public.vehicles v where v.id = v_departure.vehicle_id;
  driver := 'Assigned driver';
  fare := v_fare;
  created_at := v_now;
  hold_expires_at := created_at + interval '10 minutes';
  return next;
end;
$$;

revoke all on function public.admin_save_transport_route(uuid, text, text, numeric, text[], numeric[], boolean)
  from public, anon;
grant execute on function public.admin_save_transport_route(uuid, text, text, numeric, text[], numeric[], boolean)
  to authenticated;

revoke all on function public.search_available_transport_departures(uuid, date, text, integer, integer)
  from public, anon;
grant execute on function public.search_available_transport_departures(uuid, date, text, integer, integer)
  to authenticated;

revoke all on function public.create_transport_booking_hold(text, uuid, integer, integer)
  from public, anon;
grant execute on function public.create_transport_booking_hold(text, uuid, integer, integer)
  to authenticated;

commit;
