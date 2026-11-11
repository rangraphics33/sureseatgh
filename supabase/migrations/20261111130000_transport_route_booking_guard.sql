-- Keep stop indexes and fare definitions stable after a departure depends on them.

begin;

create or replace function public.prevent_transport_route_changes_after_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_route_id uuid;
begin
  if tg_op = 'DELETE' then
    v_route_id := old.route_id;
  else
    v_route_id := new.route_id;
  end if;

  if exists (
    select 1
    from public.transport_departures d
    where d.route_id = v_route_id
      and (
        d.status in ('scheduled', 'boarding', 'in_progress')
        or exists (
          select 1 from public.transport_bookings b where b.departure_id = d.id
        )
      )
  ) then
    raise exception 'Stops and fares cannot change while a departure is scheduled or has booking history. Create a new route version instead.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger transport_route_stops_immutable_after_schedule
before insert or update or delete on public.transport_route_stops
for each row execute function public.prevent_transport_route_changes_after_schedule();

create trigger transport_route_fares_immutable_after_schedule
before insert or update or delete on public.transport_route_segment_fares
for each row execute function public.prevent_transport_route_changes_after_schedule();

revoke all on function public.prevent_transport_route_changes_after_schedule() from public, anon, authenticated;

commit;
