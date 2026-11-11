-- Secure route and ordered-stop management for the Supabase transport backend.
-- Route rows and their children are replaced in one transaction; publication
-- validates complete, reconciled pricing before making the route visible.

begin;

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
  v_stop_count integer;
  v_fare_count integer;
  v_fare_total numeric;
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
     or p_stops is null or p_segment_fares is null then
    raise exception 'Route name, via, fare, stops, or segment fares are invalid.'
      using errcode = '22023';
  end if;

  v_stop_count := coalesce(array_length(p_stops, 1), 0);
  v_fare_count := coalesce(array_length(p_segment_fares, 1), 0);
  if v_stop_count > 200 or v_fare_count <> greatest(0, v_stop_count - 1)
     or exists (
       select 1 from unnest(p_stops) as x(stop_name)
       where stop_name is null or length(btrim(stop_name)) not between 1 and 120
     )
     or exists (
       select 1 from unnest(p_segment_fares) as x(fare)
       where fare is not null and (fare < 0 or fare > 99999999.99 or fare <> round(fare, 2))
     ) then
    raise exception 'Stops and segment fares are invalid.' using errcode = '22023';
  end if;

  if p_route_id is null then
    insert into public.transport_routes(name, via, status, full_route_fare, created_by, updated_by)
    values (btrim(p_name), btrim(p_via), 'draft', p_full_route_fare, auth.uid(), auth.uid())
    returning id into v_route_id;
  else
    select status into v_old_status
    from public.transport_routes
    where id = p_route_id
    for update;
    if not found then
      raise exception 'Route not found.' using errcode = 'P0002';
    end if;
    v_route_id := p_route_id;
    update public.transport_routes
    set name = btrim(p_name), via = btrim(p_via),
        full_route_fare = p_full_route_fare,
        status = case when p_publish then 'published' else 'draft' end,
        updated_by = auth.uid()
    where id = v_route_id;
  end if;

  delete from public.transport_route_stops where route_id = v_route_id;
  delete from public.transport_route_segment_fares where route_id = v_route_id;

  insert into public.transport_route_stops(route_id, stop_index, stop_name)
  select v_route_id, ordinality::integer - 1, btrim(stop_name)
  from unnest(p_stops) with ordinality as stops(stop_name, ordinality);

  insert into public.transport_route_segment_fares(route_id, from_stop_index, to_stop_index, fare)
  select v_route_id, ordinality::integer - 1, ordinality::integer, fare
  from unnest(p_segment_fares) with ordinality as fares(fare, ordinality)
  where fare is not null;

  if p_publish then
    select coalesce(sum(fare), 0) into v_fare_total
    from public.transport_route_segment_fares where route_id = v_route_id;
    if v_stop_count < 2 or v_fare_count <> v_stop_count - 1
       or (select count(*) from public.transport_route_segment_fares where route_id = v_route_id) <> v_stop_count - 1
       or v_fare_total <> p_full_route_fare then
      raise exception 'Route needs at least two stops and complete segment fares equal to the full-route fare.'
        using errcode = '23514';
    end if;
    update public.transport_routes set status = 'published' where id = v_route_id;
  end if;

  perform public.write_audit_log(
    case when p_publish then 'transport_route.published'
         when p_route_id is null then 'transport_route.created'
         else 'transport_route.updated' end,
    null,
    jsonb_build_object('route_id', v_route_id, 'previous_status', v_old_status,
      'status', case when p_publish then 'published' else 'draft' end,
      'stop_count', v_stop_count)
  );
  return v_route_id;
end;
$$;

revoke all on function public.admin_save_transport_route(uuid, text, text, numeric, text[], numeric[], boolean)
  from public, anon;
grant execute on function public.admin_save_transport_route(uuid, text, text, numeric, text[], numeric[], boolean)
  to authenticated;

commit;
