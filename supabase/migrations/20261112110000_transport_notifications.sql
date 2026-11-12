-- Transactional in-app notifications for passenger and driver transport updates.

begin;

create table public.transport_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.transport_bookings(id) on delete set null,
  departure_id uuid references public.transport_departures(id) on delete set null,
  source_key text not null unique,
  event_type text not null check (event_type in (
    'booking_confirmed', 'booking_cancelled', 'booking_expired',
    'boarding_verified', 'completion_requested', 'journey_completed',
    'departure_updated', 'departure_cancelled'
  )),
  title text not null check (length(btrim(title)) between 1 and 120),
  message text not null check (length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index transport_notifications_recipient_created_idx
  on public.transport_notifications(recipient_user_id, created_at desc);
create index transport_notifications_recipient_unread_idx
  on public.transport_notifications(recipient_user_id, created_at desc)
  where read_at is null;

alter table public.transport_notifications enable row level security;
revoke all on public.transport_notifications from public, anon, authenticated;
grant select on public.transport_notifications to authenticated;

create policy transport_notifications_read_owner
on public.transport_notifications for select to authenticated
using (recipient_user_id = auth.uid());

create function public.enqueue_transport_notification(
  p_recipient_user_id uuid,
  p_source_key text,
  p_event_type text,
  p_title text,
  p_message text,
  p_booking_id uuid default null,
  p_departure_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.transport_notifications (
    recipient_user_id, source_key, event_type, title, message, booking_id, departure_id
  )
  select p_recipient_user_id, p_source_key, p_event_type, p_title, p_message,
         p_booking_id, p_departure_id
  where p_recipient_user_id is not null and p_source_key is not null
  on conflict (source_key) do nothing;
$$;

create function public.notify_transport_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_passenger_id uuid;
  v_driver_id uuid;
begin
  select b.passenger_user_id, d.driver_user_id
    into v_passenger_id, v_driver_id
  from public.transport_bookings b
  join public.transport_departures d on d.id = b.departure_id
  where b.id = new.booking_id and d.id = new.departure_id;

  if new.event_type = 'boarding_verified' then
    perform public.enqueue_transport_notification(
      v_passenger_id, 'transport-event:' || new.id || ':passenger',
      'boarding_verified', 'Boarding confirmed',
      'Your driver verified your booking code and marked you as boarded.',
      new.booking_id, new.departure_id
    );
  elsif new.event_type = 'passenger_completion_requested' then
    perform public.enqueue_transport_notification(
      v_driver_id, 'transport-event:' || new.id || ':driver',
      'completion_requested', 'Passenger completion request',
      'A passenger has requested journey completion. Confirm after they are off the vehicle.',
      new.booking_id, new.departure_id
    );
  elsif new.event_type = 'driver_completion_confirmed' then
    perform public.enqueue_transport_notification(
      v_passenger_id, 'transport-event:' || new.id || ':passenger',
      'journey_completed', 'Journey completed',
      'Your driver confirmed that your journey is complete.',
      new.booking_id, new.departure_id
    );
  end if;

  return new;
end;
$$;

create trigger transport_events_notify_participant
after insert on public.transport_events
for each row execute function public.notify_transport_event();

create function public.notify_transport_booking_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'confirmed' then
      perform public.enqueue_transport_notification(
        new.passenger_user_id, 'booking-confirmed:' || new.id,
        'booking_confirmed', 'Payment confirmed',
        'Your payment was verified and your booking is confirmed.',
        new.id, new.departure_id
      );
    elsif new.status = 'cancelled' then
      perform public.enqueue_transport_notification(
        new.passenger_user_id, 'booking-cancelled:' || new.id,
        'booking_cancelled', 'Booking cancelled',
        'Your booking was cancelled. Open My Trips to review the latest status.',
        new.id, new.departure_id
      );
    elsif new.status = 'expired' then
      perform public.enqueue_transport_notification(
        new.passenger_user_id, 'booking-expired:' || new.id,
        'booking_expired', 'Booking hold expired',
        'Your payment hold expired before payment was confirmed. Search again to book this trip.',
        new.id, new.departure_id
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger transport_bookings_notify_status
after update of status on public.transport_bookings
for each row execute function public.notify_transport_booking_status();

create function public.notify_transport_departure_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_title text;
  v_message text;
  v_source text;
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    v_event_type := 'departure_cancelled';
    v_title := 'Departure cancelled';
    v_message := 'Your scheduled departure was cancelled. Open My Trips for booking details.';
    v_source := 'departure-cancelled:' || new.id || ':' || clock_timestamp();
  elsif old.travel_date is distinct from new.travel_date
     or old.departure_time is distinct from new.departure_time
     or old.vehicle_id is distinct from new.vehicle_id
     or old.driver_user_id is distinct from new.driver_user_id then
    v_event_type := 'departure_updated';
    v_title := 'Trip details updated';
    v_message := 'Your scheduled trip details changed. Open My Trips to review the latest information.';
    v_source := 'departure-updated:' || new.id || ':' || clock_timestamp();
  else
    return new;
  end if;

  perform public.enqueue_transport_notification(
    b.passenger_user_id, v_source || ':' || b.id,
    v_event_type, v_title, v_message, b.id, new.id
  )
  from public.transport_bookings b
  where b.departure_id = new.id and b.status = 'confirmed';

  return new;
end;
$$;

create trigger transport_departures_notify_changes
after update of travel_date, departure_time, vehicle_id, driver_user_id, status
on public.transport_departures
for each row execute function public.notify_transport_departure_change();

create function public.list_my_transport_notifications(p_limit integer default 50)
returns table (
  notification_id uuid,
  booking_id uuid,
  departure_id uuid,
  event_type text,
  title text,
  message text,
  created_at timestamptz,
  read_at timestamptz
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
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Notification limit must be between 1 and 100.' using errcode = '22023';
  end if;

  return query
  select n.id, n.booking_id, n.departure_id, n.event_type, n.title,
         n.message, n.created_at, n.read_at
  from public.transport_notifications n
  where n.recipient_user_id = auth.uid()
  order by n.created_at desc
  limit p_limit;
end;
$$;

create function public.mark_my_transport_notifications_read(p_notification_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  update public.transport_notifications n
  set read_at = now()
  where n.recipient_user_id = auth.uid()
    and n.read_at is null
    and (p_notification_ids is null or n.id = any(p_notification_ids));
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.enqueue_transport_notification(uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.notify_transport_event() from public, anon, authenticated;
revoke all on function public.notify_transport_booking_status() from public, anon, authenticated;
revoke all on function public.notify_transport_departure_change() from public, anon, authenticated;
revoke all on function public.list_my_transport_notifications(integer) from public, anon;
revoke all on function public.mark_my_transport_notifications_read(uuid[]) from public, anon;

grant execute on function public.list_my_transport_notifications(integer) to authenticated;
grant execute on function public.mark_my_transport_notifications_read(uuid[]) to authenticated;

commit;
