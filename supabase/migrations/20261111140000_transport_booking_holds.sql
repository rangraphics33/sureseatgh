-- Passenger-visible departure search and atomic, idempotent, segment-aware holds.

begin;

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
         capacity.available_seats, pricing.fare
  from public.transport_departures d
  join public.transport_routes r on r.id = d.route_id and r.status = 'published'
  join public.vehicles v on v.id = d.vehicle_id
  cross join lateral (
    select sum(f.fare)::numeric(10,2) as fare, count(*)::integer as segment_count
    from public.transport_route_segment_fares f
    where f.route_id = d.route_id
      and f.from_stop_index >= p_pickup_stop_index
      and f.from_stop_index < p_dropoff_stop_index
  ) pricing
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
    and p_dropoff_stop_index < (
      select count(*) from public.transport_route_stops s where s.route_id = d.route_id
    )
    and exists (select 1 from public.transport_route_stops s
      where s.route_id = d.route_id and s.stop_index = p_pickup_stop_index)
    and exists (select 1 from public.transport_route_stops s
      where s.route_id = d.route_id and s.stop_index = p_dropoff_stop_index)
    and pricing.segment_count = p_dropoff_stop_index - p_pickup_stop_index
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
  v_segment_count integer;
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
  if not exists (
    select 1 from public.transport_routes r
    where r.id = v_departure.route_id and r.status = 'published'
  ) then
    raise exception 'This route is no longer available for booking.' using errcode = '23514';
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
  select sum(f.fare)::numeric(10,2), count(*)::integer
  into v_fare, v_segment_count
  from public.transport_route_segment_fares f
  where f.route_id = v_departure.route_id
    and f.from_stop_index >= p_pickup_stop_index
    and f.from_stop_index < p_dropoff_stop_index;
  if v_segment_count <> p_dropoff_stop_index - p_pickup_stop_index then
    raise exception 'Pricing is incomplete for the selected journey.' using errcode = '23514';
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

create or replace function public.list_my_transport_bookings(
  p_page integer default 1,
  p_page_size integer default 20
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
  hold_expires_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_role('passenger') then
    raise exception 'Passenger authentication is required.' using errcode = '42501';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Page and page size are invalid.' using errcode = '22023';
  end if;

  update public.transport_bookings b
  set status = 'expired'
  where b.passenger_user_id = auth.uid()
    and b.status = 'pending_payment' and b.hold_expires_at <= clock_timestamp();

  return query
  select b.id, b.booking_code, b.status, r.id, r.name, ps.stop_name, ds.stop_name,
         d.travel_date, d.departure_time, d.id, v.vehicle_type, 'Assigned driver'::text,
         b.fare, b.created_at, b.hold_expires_at, count(*) over()
  from public.transport_bookings b
  join public.transport_departures d on d.id = b.departure_id
  join public.transport_routes r on r.id = d.route_id
  join public.vehicles v on v.id = d.vehicle_id
  join public.transport_route_stops ps on ps.route_id = d.route_id and ps.stop_index = b.pickup_stop_index
  join public.transport_route_stops ds on ds.route_id = d.route_id and ds.stop_index = b.dropoff_stop_index
  where b.passenger_user_id = auth.uid()
  order by b.created_at desc
  offset (p_page - 1) * p_page_size
  limit p_page_size;
end;
$$;

revoke all on function public.search_available_transport_departures(uuid, date, text, integer, integer) from public, anon;
revoke all on function public.create_transport_booking_hold(text, uuid, integer, integer) from public, anon;
revoke all on function public.list_my_transport_bookings(integer, integer) from public, anon;
grant execute on function public.search_available_transport_departures(uuid, date, text, integer, integer) to authenticated;
grant execute on function public.create_transport_booking_hold(text, uuid, integer, integer) to authenticated;
grant execute on function public.list_my_transport_bookings(integer, integer) to authenticated;

commit;
