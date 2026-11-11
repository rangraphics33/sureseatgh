import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261110030000_transport_core.sql', import.meta.url),
  'utf8',
)
const authMigration = readFileSync(
  new URL('../supabase/migrations/20261109150000_auth_access_foundation.sql', import.meta.url),
  'utf8',
)
const fleetMigration = readFileSync(
  new URL('../supabase/migrations/20261109235000_vehicle_fleet_management.sql', import.meta.url),
  'utf8',
)
const routeManagementMigration = readFileSync(
  new URL('../supabase/migrations/20261111040000_transport_route_management.sql', import.meta.url),
  'utf8',
)
const departureMigration = readFileSync(
  new URL('../supabase/migrations/20261111120000_transport_departure_scheduling.sql', import.meta.url),
  'utf8',
)
const routeGuardMigration = readFileSync(
  new URL('../supabase/migrations/20261111130000_transport_route_booking_guard.sql', import.meta.url),
  'utf8',
)
const bookingHoldsMigration = readFileSync(
  new URL('../supabase/migrations/20261111140000_transport_booking_holds.sql', import.meta.url),
  'utf8',
)

test('transport migration uses the existing fleet and authorization schema', () => {
  assert.match(fleetMigration, /create table public\.vehicles/i)
  assert.match(migration, /vehicle_id uuid not null references public\.vehicles\(id\)/i)
  assert.match(authMigration, /create function public\.set_updated_at\(\)/i)
  assert.match(migration, /execute function public\.set_updated_at\(\)/i)
  for (const permission of ['routes.manage', 'bookings.read', 'audit.read']) {
    assert.ok(authMigration.includes(`'${permission}'`), `missing existing permission ${permission}`)
  }
})

test('transport departures are shared runs with individual passenger bookings', () => {
  assert.match(migration, /create table public\.transport_departures/i)
  assert.match(migration, /create table public\.transport_bookings/i)
  assert.match(
    migration,
    /departure_id uuid not null references public\.transport_departures\(id\)/i,
  )
  assert.match(migration, /passenger_user_id uuid not null references auth\.users\(id\)/i)
})

test('participant RLS avoids recursive joins between bookings and departures', () => {
  const departurePolicy = migration.match(
    /create policy transport_departures_read_participant_or_manager[\s\S]*?(?=create policy)/i,
  )?.[0]
  const bookingPolicy = migration.match(
    /create policy transport_bookings_read_owner_driver_or_manager[\s\S]*?(?=create policy)/i,
  )?.[0]
  const eventPolicy = migration.match(
    /create policy transport_events_read_participant_or_audit[\s\S]*?(?=revoke insert)/i,
  )?.[0]

  assert.match(departurePolicy ?? '', /current_user_is_transport_departure_participant/i)
  assert.match(bookingPolicy ?? '', /current_user_is_transport_departure_driver/i)
  assert.match(eventPolicy ?? '', /current_user_is_transport_booking_participant/i)
  for (const helper of [
    'current_user_is_transport_departure_driver',
    'current_user_is_transport_departure_participant',
    'current_user_is_transport_booking_participant',
  ]) {
    const definition = migration.match(
      new RegExp(`create or replace function public\\.${helper}\\([\\s\\S]*?\\$\\$;`, 'i'),
    )?.[0]
    assert.match(definition ?? '', /security definer/i)
    assert.match(definition ?? '', /set search_path = ''/i)
    assert.match(migration, new RegExp(`revoke all on function public\\.${helper}`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${helper}`, 'i'))
  }
})

test('booking codes and idempotency keys are not directly selectable', () => {
  const bookingSelectGrant = migration.match(
    /grant select\s*\(([\s\S]*?)\)\s*on public\.transport_bookings/i,
  )?.[1]
  assert.ok(bookingSelectGrant)
  assert.doesNotMatch(bookingSelectGrant, /booking_code|idempotency_key/i)
  assert.match(
    migration,
    /revoke all on public\.transport_bookings from public, anon, authenticated/i,
  )
})

test('transport RPCs are unavailable to PUBLIC and anon', () => {
  for (const [name, signature] of [
    ['request_passenger_journey_completion', 'uuid'],
    ['confirm_passenger_journey_completion', 'uuid'],
    ['verify_transport_booking_code', 'text'],
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\(${signature}\\)[\\s\\S]*?from public, anon`, 'i'),
    )
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\(${signature}\\)[\\s\\S]*?to authenticated`, 'i'),
    )
  }
})

test('route management uses a permission-checked atomic RPC and audits changes', () => {
  const definition = routeManagementMigration.match(
    /create or replace function public\.admin_save_transport_route\([\s\S]*?\$\$;/i,
  )?.[0]
  assert.match(definition ?? '', /security definer/i)
  assert.match(definition ?? '', /set search_path = ''/i)
  assert.match(definition ?? '', /current_user_has_permission\('routes\.manage'\)/i)
  assert.match(definition ?? '', /for update/i)
  assert.match(definition ?? '', /delete from public\.transport_route_stops/i)
  assert.match(definition ?? '', /delete from public\.transport_route_segment_fares/i)
  assert.match(definition ?? '', /segment_fares[\s\S]*?v_fare_total <> p_full_route_fare/i)
  assert.match(definition ?? '', /public\.write_audit_log/i)
  assert.match(routeManagementMigration, /revoke all on function public\.admin_save_transport_route[\s\S]*?from public, anon/i)
  assert.match(routeManagementMigration, /grant execute on function public\.admin_save_transport_route[\s\S]*?to authenticated/i)
})

test('departure scheduling reuses fleet tables and requires eligible assignments', () => {
  assert.doesNotMatch(departureMigration, /create table public\.(transport_departures|vehicles|vehicle_assignments)/i)
  assert.match(departureMigration, /current_user_has_permission\('routes\.manage'\)/i)
  assert.match(departureMigration, /(?:from|join) public\.vehicle_assignments/i)
  assert.match(departureMigration, /join public\.vehicles/i)
  assert.match(departureMigration, /join public\.driver_applications/i)
  assert.match(departureMigration, /current approved documents through the departure date/i)
  assert.match(departureMigration, /only scheduled departures without bookings can be changed/i)
  assert.match(departureMigration, /transport_departure\.scheduled/i)
  assert.match(departureMigration, /transport_departures_read_participant_or_manager[\s\S]*?routes\.manage/i)
  for (const functionName of ['list_transport_departure_assignments', 'admin_save_transport_departure']) {
    const definition = departureMigration.match(
      new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?\\$\\$;`, 'i'),
    )?.[0]
    assert.match(definition ?? '', /security definer/i)
    assert.match(definition ?? '', /set search_path = ''/i)
    assert.match(departureMigration, new RegExp(`revoke all on function public\\.${functionName}`, 'i'))
  }
})

test('route stops and fares stay stable once scheduled departures depend on them', () => {
  assert.match(routeGuardMigration, /security definer/i)
  assert.match(routeGuardMigration, /set search_path = ''/i)
  assert.match(routeGuardMigration, /d\.status in \('scheduled', 'boarding', 'in_progress'\)/i)
  assert.match(routeGuardMigration, /transport_bookings b where b\.departure_id = d\.id/i)
  assert.match(routeGuardMigration, /create trigger transport_route_stops_immutable_after_schedule/i)
  assert.match(routeGuardMigration, /create trigger transport_route_fares_immutable_after_schedule/i)
  assert.match(routeGuardMigration, /revoke all on function public\.prevent_transport_route_changes_after_schedule/i)
})

test('booking holds are passenger-only, idempotent, authoritative, and capacity-locked', () => {
  assert.doesNotMatch(bookingHoldsMigration, /create table public\.transport_bookings/i)
  const createHold = bookingHoldsMigration.match(
    /create or replace function public\.create_transport_booking_hold\([\s\S]*?\$\$;/i,
  )?.[0]
  assert.match(createHold ?? '', /current_account_can_create_bookings\(\)/i)
  assert.match(createHold ?? '', /current_user_has_role\('passenger'\)/i)
  assert.match(createHold ?? '', /pg_advisory_xact_lock/i)
  assert.match(createHold ?? '', /for update/i)
  assert.match(createHold ?? '', /unique.*different booking request|already used for a different booking request/i)
  assert.match(createHold ?? '', /sum\(f\.fare\)/i)
  assert.match(createHold ?? '', /generate_series/i)
  assert.match(createHold ?? '', /hold_expires_at > v_now/i)
  assert.match(createHold ?? '', /interval '10 minutes'/i)
  assert.match(createHold ?? '', /public\.write_audit_log/i)
  assert.doesNotMatch(createHold ?? '', /p_fare|p_amount/i)
  for (const functionName of [
    'search_available_transport_departures',
    'create_transport_booking_hold',
    'list_my_transport_bookings',
  ]) {
    const definition = bookingHoldsMigration.match(
      new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?\\$\\$;`, 'i'),
    )?.[0]
    assert.match(definition ?? '', /security definer/i)
    assert.match(definition ?? '', /set search_path = ''/i)
    assert.match(bookingHoldsMigration, new RegExp(`revoke all on function public\\.${functionName}`, 'i'))
    assert.match(bookingHoldsMigration, new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to authenticated`, 'i'))
  }
})
