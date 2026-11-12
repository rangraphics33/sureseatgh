import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112030000_transport_standard_route_fares.sql', import.meta.url),
  'utf8',
)

test('legacy route totals are cleared and published routes require fare re-approval', () => {
  assert.match(migration, /update public\.transport_routes[\s\S]*?status = case when status = 'published' then 'draft' else status end[\s\S]*?full_route_fare = 0/i)
})

test('route management publishes using one positive route fare and leaves legacy segment fares unused', () => {
  const saveRoute = migration.match(/create or replace function public\.admin_save_transport_route\([\s\S]*?\$\$;/i)?.[0]
  assert.match(saveRoute ?? '', /current_user_has_permission\('routes\.manage'\)/i)
  assert.match(saveRoute ?? '', /p_publish and \(v_stop_count < 2 or p_full_route_fare <= 0\)/i)
  assert.match(saveRoute ?? '', /p_segment_fares remains in the rpc signature/i)
  assert.doesNotMatch(saveRoute ?? '', /insert into public\.transport_route_segment_fares/i)
  assert.match(saveRoute ?? '', /write_audit_log/i)
})

test('departure search returns the route fare for every stop pair and retains segment capacity checks', () => {
  const search = migration.match(/create or replace function public\.search_available_transport_departures\([\s\S]*?\$\$;/i)?.[0]
  assert.match(search ?? '', /r\.full_route_fare::numeric/i)
  assert.doesNotMatch(search ?? '', /transport_route_segment_fares/i)
  assert.match(search ?? '', /generate_series\(p_pickup_stop_index, p_dropoff_stop_index - 1\)/i)
  assert.match(search ?? '', /capacity\.available_seats > 0/i)
})

test('booking holds calculate price in the database and preserve idempotency, payment snapshots, and capacity locks', () => {
  const createHold = migration.match(/create or replace function public\.create_transport_booking_hold\([\s\S]*?\$\$;/i)?.[0]
  assert.match(createHold ?? '', /pg_advisory_xact_lock/i)
  assert.match(createHold ?? '', /select r\.full_route_fare into v_fare/i)
  assert.doesNotMatch(createHold ?? '', /transport_route_segment_fares/i)
  assert.match(createHold ?? '', /for update/i)
  assert.match(createHold ?? '', /generate_series\(p_pickup_stop_index, p_dropoff_stop_index - 1\)/i)
  assert.match(createHold ?? '', /dropoff_stop_index, fare, status, idempotency_key/i)
  assert.match(createHold ?? '', /public\.write_audit_log/i)
})

test('updated RPCs remain inaccessible to anon and executable by authenticated users only', () => {
  for (const fn of [
    'admin_save_transport_route',
    'search_available_transport_departures',
    'create_transport_booking_hold',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*?from public, anon`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to authenticated`, 'i'))
  }
})
