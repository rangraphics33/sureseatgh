-- Server-owned Paystack payment attempts for passenger transport bookings.
-- One attempt per booking is deliberate: retries reuse the same provider reference.
-- A confirmed booking is never derived from browser redirect/query parameters.

begin;

create table public.transport_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.transport_bookings(id) on delete restrict,
  passenger_user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_reference text not null unique,
  status text not null default 'initializing'
    check (status in ('initializing', 'checkout_ready', 'succeeded', 'failed', 'succeeded_unapplied', 'review_required')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'GHS' check (currency = 'GHS'),
  authorization_url text,
  provider_transaction_id text unique,
  provider_domain text check (provider_domain is null or provider_domain in ('test', 'live')),
  failure_code text,
  initialized_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (authorization_url is null or authorization_url like 'https://checkout.paystack.com/%'),
  check (status <> 'checkout_ready' or authorization_url is not null)
);

create index transport_payment_attempts_passenger_idx
  on public.transport_payment_attempts(passenger_user_id, created_at desc);

create trigger transport_payment_attempts_set_updated_at
before update on public.transport_payment_attempts
for each row execute function public.set_updated_at();

alter table public.transport_payment_attempts enable row level security;
revoke all on public.transport_payment_attempts from public, anon, authenticated;
grant select on public.transport_payment_attempts to service_role;

-- Called only by trusted Edge Functions with the service role. Locks the booking
-- and reuses its only attempt, so double clicks/retries cannot create a second charge.
create or replace function public.reserve_transport_booking_payment(
  p_passenger_user_id uuid,
  p_booking_id uuid,
  p_provider_reference text
)
returns table (
  attempt_id uuid,
  provider_reference text,
  attempt_status text,
  amount_minor bigint,
  currency text,
  authorization_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.transport_bookings%rowtype;
  v_attempt public.transport_payment_attempts%rowtype;
  v_amount_minor bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted payment service required.' using errcode = '42501';
  end if;
  if p_passenger_user_id is null or p_booking_id is null or p_provider_reference is null
     or p_provider_reference !~ '^SS-[A-Za-z0-9-]{20,80}$' then
    raise exception 'Payment request is invalid.' using errcode = '22023';
  end if;

  select * into v_booking
  from public.transport_bookings b
  where b.id = p_booking_id and b.passenger_user_id = p_passenger_user_id
  for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'pending_payment' or v_booking.hold_expires_at <= clock_timestamp() then
    raise exception 'This booking hold has expired or is no longer payable.' using errcode = '23514';
  end if;

  select * into v_attempt from public.transport_payment_attempts a
  where a.booking_id = v_booking.id for update;
  if found then
    attempt_id := v_attempt.id;
    provider_reference := v_attempt.provider_reference;
    attempt_status := v_attempt.status;
    amount_minor := v_attempt.amount_minor;
    currency := v_attempt.currency;
    authorization_url := v_attempt.authorization_url;
    return next;
    return;
  end if;

  v_amount_minor := round(v_booking.fare * 100)::bigint;
  if v_amount_minor <= 0 then
    raise exception 'Booking amount is invalid.' using errcode = '23514';
  end if;
  insert into public.transport_payment_attempts(
    booking_id, passenger_user_id, provider_reference, amount_minor, currency
  ) values (
    v_booking.id, v_booking.passenger_user_id, p_provider_reference, v_amount_minor, 'GHS'
  ) returning * into v_attempt;

  attempt_id := v_attempt.id;
  provider_reference := v_attempt.provider_reference;
  attempt_status := v_attempt.status;
  amount_minor := v_attempt.amount_minor;
  currency := v_attempt.currency;
  authorization_url := v_attempt.authorization_url;
  return next;
end;
$$;

create or replace function public.set_transport_payment_checkout(
  p_provider_reference text,
  p_authorization_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted payment service required.' using errcode = '42501';
  end if;
  if p_authorization_url !~ '^https://checkout\.paystack\.com/' then
    raise exception 'Payment checkout URL is invalid.' using errcode = '22023';
  end if;
  update public.transport_payment_attempts
  set authorization_url = p_authorization_url,
      status = 'checkout_ready',
      initialized_at = coalesce(initialized_at, now()),
      failure_code = null
  where provider_reference = p_provider_reference and status = 'initializing';
  if not found then
    raise exception 'Payment attempt is missing or no longer initializable.' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.fail_transport_payment_attempt(
  p_provider_reference text,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted payment service required.' using errcode = '42501';
  end if;
  update public.transport_payment_attempts
  set status = 'failed', failure_code = left(coalesce(p_failure_code, 'provider_terminal_failure'), 80),
      verified_at = now()
  where provider_reference = p_provider_reference
    and status in ('initializing', 'checkout_ready');
end;
$$;

create or replace function public.confirm_transport_booking_payment(
  p_provider_reference text,
  p_provider_transaction_id text,
  p_amount_minor bigint,
  p_currency text,
  p_provider_domain text,
  p_provider_says_success boolean
)
returns table (payment_status text, booking_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.transport_payment_attempts%rowtype;
  v_booking public.transport_bookings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_valid boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted payment service required.' using errcode = '42501';
  end if;

  select * into v_attempt from public.transport_payment_attempts a
  where a.provider_reference = p_provider_reference for update;
  if not found then
    raise exception 'Payment reference not found.' using errcode = 'P0002';
  end if;
  select * into v_booking from public.transport_bookings b
  where b.id = v_attempt.booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  if v_attempt.status in ('succeeded', 'succeeded_unapplied', 'review_required') then
    payment_status := v_attempt.status;
    booking_status := v_booking.status;
    return next;
    return;
  end if;

  if not coalesce(p_provider_says_success, false) then
    payment_status := v_attempt.status;
    booking_status := v_booking.status;
    return next;
    return;
  end if;

  v_valid := p_amount_minor = v_attempt.amount_minor
    and upper(coalesce(p_currency, '')) = v_attempt.currency
    and nullif(btrim(p_provider_transaction_id), '') is not null
    and p_provider_domain = 'test';

  if v_valid is not true then
    update public.transport_payment_attempts
    set status = 'review_required', provider_transaction_id = p_provider_transaction_id,
        provider_domain = p_provider_domain, verified_at = v_now,
        failure_code = 'verified_payment_details_mismatch'
    where id = v_attempt.id;
    payment_status := 'review_required';
    booking_status := v_booking.status;
    return next;
    return;
  end if;

  -- Serialize seat confirmation with booking holds. The booking itself already
  -- consumes capacity while its hold is valid; this lock prevents racing expiry.
  perform 1 from public.transport_departures d
  where d.id = v_booking.departure_id for update;

  if v_booking.status = 'pending_payment'
     and v_booking.hold_expires_at > v_now
     and exists (select 1 from public.transport_departures d
       where d.id = v_booking.departure_id and d.status = 'scheduled') then
    update public.transport_bookings
    set status = 'confirmed', confirmed_at = v_now
    where id = v_booking.id;
    update public.transport_payment_attempts
    set status = 'succeeded', provider_transaction_id = p_provider_transaction_id,
        provider_domain = p_provider_domain, verified_at = v_now, failure_code = null
    where id = v_attempt.id;
    payment_status := 'succeeded';
    booking_status := 'confirmed';
  else
    -- Money was received but the reservation can no longer be honored. Keep a
    -- durable exception for refund/support handling; never silently confirm it.
    update public.transport_payment_attempts
    set status = 'succeeded_unapplied', provider_transaction_id = p_provider_transaction_id,
        provider_domain = p_provider_domain, verified_at = v_now,
        failure_code = 'payment_received_after_booking_hold_expired'
    where id = v_attempt.id;
    payment_status := 'succeeded_unapplied';
    booking_status := v_booking.status;
  end if;

  return next;
end;
$$;

revoke all on function public.reserve_transport_booking_payment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_transport_payment_checkout(text, text) from public, anon, authenticated;
revoke all on function public.fail_transport_payment_attempt(text, text) from public, anon, authenticated;
revoke all on function public.confirm_transport_booking_payment(text, text, bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.reserve_transport_booking_payment(uuid, uuid, text) to service_role;
grant execute on function public.set_transport_payment_checkout(text, text) to service_role;
grant execute on function public.fail_transport_payment_attempt(text, text) to service_role;
grant execute on function public.confirm_transport_booking_payment(text, text, bigint, text, text, boolean) to service_role;

commit;
