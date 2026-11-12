-- Publish private in-app notifications to Supabase Realtime.
-- Row-level security still limits each subscriber to their own notifications.

begin;

do $$
begin
  if to_regclass('public.transport_notifications') is null then
    raise notice 'transport_notifications is not installed; apply 20261112110000_transport_notifications.sql first.';
  elsif exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'transport_notifications'
    ) then
      execute 'alter publication supabase_realtime add table public.transport_notifications';
    end if;
  else
    raise notice 'supabase_realtime publication is not enabled; notification polling remains available.';
  end if;
end;
$$;

commit;
