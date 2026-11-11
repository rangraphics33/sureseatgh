-- SureSeat 2.0 unified transport foundation
-- Model:
--   transport_departures = shared vehicle run
--   transport_bookings   = one passenger's individual journey on that run
--   transport_events     = immutable operational event history
--
-- This migration intentionally does not implement payment capture/verification
-- or booking creation. Those require the existing server/API contract.

begin;

create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  via text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  full_route_fare numeric(10,2) not null default 0 check (full_route_fare >= 0),
  currency text not null default 'GHS' check (currency = 'GHS'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transport_route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.transport_routes(id) on delete cascade,
  stop_index integer not null check (stop_index >= 0),
  stop_name text not null check (length(btrim(stop_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (route_id, stop_index)
);

create table public.transport_route_segment_fares (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.transport_routes(id) on delete cascade,
  from_stop_index integer not null check (from_stop_index >= 0),
  to_stop_index integer not null check (to_stop_index = from_stop_index + 1),
  fare numeric(10,2) not null check (fare >= 0),
  unique (route_id, from_stop_index)
);

create table public.transport_departures (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.transport_routes(id) on delete restrict,
  travel_date date not null,
  departure_time time not null,
  driver_user_id uuid not null references auth.users(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'boarding', 'in_progress', 'completed', 'cancelled')),
  capacity integer not null check (capacity between 1 and 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transport_departures_search_idx
  on public.transport_departures(route_id, travel_date, departure_time)
  where status in ('scheduled', 'boarding', 'in_progress');

create index transport_departures_driver_idx
  on public.transport_departures(driver_user_id, travel_date desc);

create table public.transport_bookings (
  id uuid primary key default gen_random_uuid(),
  departure_id uuid not null references public.transport_departures(id) on delete restrict,
  passenger_user_id uuid not null references auth.users(id) on delete restrict,
  booking_code text not null unique,
  pickup_stop_index integer not null check (pickup_stop_index >= 0),
  dropoff_stop_index integer not null check (dropoff_stop_index > pickup_stop_index),
  fare numeric(10,2) not null check (fare >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled', 'completed', 'expired')),
  journey_status text not null default 'not_boarded'
    check (journey_status in ('not_boarded', 'boarded', 'completion_requested', 'completed')),
  idempotency_key text not null,
  hold_expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  boarded_at timestamptz,
  completion_requested_at timestamptz,
  completed_at timestamptz,
  unique (passenger_user_id, idempotency_key),
  check (
    (journey_status = 'not_boarded' and boarded_at is null
      and completion_requested_at is null and completed_at is null)
    or (journey_status = 'boarded' and boarded_at is not null
      and completion_requested_at is null and completed_at is null)
    or (journey_status = 'completion_requested' and boarded_at is not null
      and completion_requested_at is not null and completed_at is null)
    or (journey_status = 'completed' and boarded_at is not null
      and completion_requested_at is not null and completed_at is not null)
  )
);

create index transport_bookings_passenger_idx
  on public.transport_bookings(passenger_user_id, created_at desc);
create index transport_bookings_departure_idx
  on public.transport_bookings(departure_id, status, journey_status);

create table public.transport_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.transport_bookings(id) on delete restrict,
  departure_id uuid not null references public.transport_departures(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'boarding_verified',
    'passenger_completion_requested',
    'driver_completion_confirmed'
  )),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index transport_events_booking_idx
  on public.transport_events(booking_id, created_at);

create trigger transport_routes_set_updated_at
before update on public.transport_routes
for each row execute function public.set_updated_at();

create trigger transport_departures_set_updated_at
before update on public.transport_departures
for each row execute function public.set_updated_at();

alter table public.transport_routes enable row level security;
alter table public.transport_route_stops enable row level security;
alter table public.transport_route_segment_fares enable row level security;
alter table public.transport_departures enable row level security;
alter table public.transport_bookings enable row level security;
alter table public.transport_events enable row level security;

grant select on public.transport_routes, public.transport_route_stops,
  public.transport_route_segment_fares, public.transport_departures,
  public.transport_events to authenticated;

revoke all on public.transport_bookings from public, anon, authenticated;
grant select (
  id, departure_id, passenger_user_id, pickup_stop_index, dropoff_stop_index,
  fare, status, journey_status, hold_expires_at, created_at, confirmed_at,
  cancelled_at, boarded_at, completion_requested_at, completed_at
) on public.transport_bookings to authenticated;

create or replace function public.current_user_is_transport_departure_driver(
  p_departure_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.transport_departures d
    where d.id = p_departure_id
      and d.driver_user_id = auth.uid()
  );
$$;

create or replace function public.current_user_is_transport_departure_participant(
  p_departure_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    public.current_user_is_transport_departure_driver(p_departure_id)
    or exists (
      select 1
      from public.transport_bookings b
      where b.departure_id = p_departure_id
        and b.passenger_user_id = auth.uid()
    )
  );
$$;

create or replace function public.current_user_is_transport_booking_participant(
  p_booking_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.transport_bookings b
    join public.transport_departures d on d.id = b.departure_id
    where b.id = p_booking_id
      and (b.passenger_user_id = auth.uid() or d.driver_user_id = auth.uid())
  );
$$;

create policy transport_routes_read_published_or_manager
on public.transport_routes for select to authenticated
using (
  status = 'published'
  or public.current_user_has_permission('routes.manage')
);

create policy transport_route_stops_read_published_or_manager
on public.transport_route_stops for select to authenticated
using (
  exists (
    select 1 from public.transport_routes r
    where r.id = route_id
      and (r.status = 'published'
        or public.current_user_has_permission('routes.manage'))
  )
);

create policy transport_segment_fares_read_published_or_manager
on public.transport_route_segment_fares for select to authenticated
using (
  exists (
    select 1 from public.transport_routes r
    where r.id = route_id
      and (r.status = 'published'
        or public.current_user_has_permission('routes.manage'))
  )
);

create policy transport_departures_read_participant_or_manager
on public.transport_departures for select to authenticated
using (
  public.current_user_has_permission('bookings.read')
  or public.current_user_is_transport_departure_participant(id)
);

create policy transport_bookings_read_owner_driver_or_manager
on public.transport_bookings for select to authenticated
using (
  passenger_user_id = auth.uid()
  or public.current_user_is_transport_departure_driver(departure_id)
  or public.current_user_has_permission('bookings.read')
);

create policy transport_events_read_participant_or_audit
on public.transport_events for select to authenticated
using (
  public.current_user_is_transport_booking_participant(booking_id)
  or public.current_user_has_permission('audit.read')
);

revoke insert, update, delete on public.transport_routes,
  public.transport_route_stops, public.transport_route_segment_fares,
  public.transport_departures, public.transport_bookings,
  public.transport_events from anon, authenticated;

create or replace function public.request_passenger_journey_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.transport_bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_booking
  from public.transport_bookings
  where id = p_booking_id and passenger_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  if v_booking.status <> 'confirmed' or v_booking.journey_status <> 'boarded' then
    if v_booking.journey_status = 'completion_requested' then return; end if;
    raise exception 'Only a boarded, confirmed journey can request completion.'
      using errcode = '23514';
  end if;

  update public.transport_bookings
  set journey_status = 'completion_requested',
      completion_requested_at = now()
  where id = p_booking_id;

  insert into public.transport_events(booking_id, departure_id, actor_user_id, event_type)
  values (p_booking_id, v_booking.departure_id, auth.uid(),
          'passenger_completion_requested');
end;
$$;

create or replace function public.confirm_passenger_journey_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.transport_bookings%rowtype;
  v_driver_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select d.driver_user_id into v_driver_id
  from public.transport_departures d
  join public.transport_bookings b on b.departure_id = d.id
  where b.id = p_booking_id;

  if not found or v_driver_id <> auth.uid() then
    raise exception 'Only the assigned driver can confirm this passenger journey.'
      using errcode = '42501';
  end if;

  select * into v_booking
  from public.transport_bookings
  where id = p_booking_id
  for update;

  if v_booking.journey_status = 'completed' then return; end if;
  if v_booking.status <> 'confirmed'
     or v_booking.journey_status <> 'completion_requested' then
    raise exception 'There is no pending completion request for this journey.'
      using errcode = '23514';
  end if;

  update public.transport_bookings
  set journey_status = 'completed', status = 'completed', completed_at = now()
  where id = p_booking_id;

  insert into public.transport_events(booking_id, departure_id, actor_user_id, event_type)
  values (p_booking_id, v_booking.departure_id, auth.uid(),
          'driver_completion_confirmed');
end;
$$;

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
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  update public.transport_bookings b
  set journey_status = 'boarded', boarded_at = now()
  from public.transport_departures d
  where b.departure_id = d.id
    and d.driver_user_id = auth.uid()
    and b.booking_code = upper(btrim(p_booking_code))
    and b.status = 'confirmed'
    and b.journey_status = 'not_boarded'
    and d.status in ('scheduled', 'boarding', 'in_progress')
  returning b.id, b.departure_id, b.passenger_user_id, b.journey_status
  into v_booking_id, v_departure_id, v_passenger_id, v_journey_status;

  if v_booking_id is null then
    raise exception 'Booking code is invalid, already used, or not assigned to your departure.'
      using errcode = 'P0002';
  end if;

  insert into public.transport_events(booking_id, departure_id, actor_user_id, event_type)
  values (v_booking_id, v_departure_id, auth.uid(), 'boarding_verified');

  return query
  select v_booking_id, v_departure_id, v_passenger_id, v_journey_status;
end;
$$;

revoke all on function public.current_user_is_transport_departure_driver(uuid)
  from public, anon;
revoke all on function public.current_user_is_transport_departure_participant(uuid)
  from public, anon;
revoke all on function public.current_user_is_transport_booking_participant(uuid)
  from public, anon;
revoke all on function public.request_passenger_journey_completion(uuid)
  from public, anon;
revoke all on function public.confirm_passenger_journey_completion(uuid)
  from public, anon;
revoke all on function public.verify_transport_booking_code(text)
  from public, anon;

grant execute on function public.current_user_is_transport_departure_driver(uuid)
  to authenticated;
grant execute on function public.current_user_is_transport_departure_participant(uuid)
  to authenticated;
grant execute on function public.current_user_is_transport_booking_participant(uuid)
  to authenticated;
grant execute on function public.request_passenger_journey_completion(uuid)
  to authenticated;
grant execute on function public.confirm_passenger_journey_completion(uuid)
  to authenticated;
grant execute on function public.verify_transport_booking_code(text)
  to authenticated;

commit;
