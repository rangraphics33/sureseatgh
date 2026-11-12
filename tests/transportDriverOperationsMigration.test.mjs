import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112100000_transport_driver_operations.sql', import.meta.url),
  'utf8',
)

function functionBody(name) {
  const escapedName = name.replaceAll('.', '\\.')
  return migration.match(new RegExp(`create or replace function public\\.${escapedName}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? ''
}

test('driver departure list is scoped to the signed-in assigned driver and excludes unauthorized trip states', () => {
  const list = functionBody('list_my_transport_departures')
  assert.match(list, /auth\.uid\(\) is null or not public\.current_user_has_role\('driver'\)/i)
  assert.match(list, /d\.driver_user_id = auth\.uid\(\)/i)
  assert.match(list, /d\.status in \('scheduled', 'boarding', 'in_progress', 'completed'\)/i)
})

test('manifest is assigned-driver-only and exposes stop and journey details without booking codes or contact details', () => {
  const manifest = functionBody('list_transport_departure_manifest')
  assert.match(manifest, /current_user_is_transport_departure_driver\(p_departure_id\)/i)
  assert.match(manifest, /transport_route_stops/i)
  assert.match(manifest, /pickup_stop_index/i)
  assert.match(manifest, /dropoff_stop_index/i)
  assert.doesNotMatch(manifest, /booking_code|email|phone/i)
})

test('boarding and trip start are idempotent, assigned-driver-only state transitions with audit records', () => {
  const boarding = functionBody('driver_begin_transport_boarding')
  const start = functionBody('driver_start_transport_departure')
  for (const body of [boarding, start]) {
    assert.match(body, /current_user_has_role\('driver'\)/i)
    assert.match(body, /driver_user_id = auth\.uid\(\)/i)
    assert.match(body, /write_audit_log/i)
  }
  assert.match(boarding, /v_status = 'boarding' then return/i)
  assert.match(boarding, /v_status <> 'scheduled'/i)
  assert.match(start, /v_departure\.status = 'in_progress' then return/i)
  assert.match(start, /v_departure\.status <> 'boarding'/i)
  assert.match(start, /v_departure\.travel_date[\s\S]*?departure_time > localtime/i)
})

test('booking code verification only boards confirmed, not-yet-boarded bookings on an open departure', () => {
  const verify = functionBody('verify_transport_booking_code')
  assert.match(verify, /current_user_has_role\('driver'\)/i)
  assert.match(verify, /d\.driver_user_id = auth\.uid\(\)/i)
  assert.match(verify, /b\.status = 'confirmed'/i)
  assert.match(verify, /b\.journey_status = 'not_boarded'/i)
  assert.match(verify, /d\.status in \('boarding', 'in_progress'\)/i)
  assert.match(verify, /insert into public\.transport_events/i)
})

test('all new driver functions remain unavailable to anon and executable by authenticated users', () => {
  for (const name of [
    'list_my_transport_departures',
    'list_transport_departure_manifest',
    'driver_begin_transport_boarding',
    'driver_start_transport_departure',
    'verify_transport_booking_code',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public, anon`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to authenticated`, 'i'))
  }
})
