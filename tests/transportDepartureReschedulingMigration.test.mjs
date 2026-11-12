import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112120000_transport_departure_rescheduling.sql', import.meta.url),
  'utf8',
)

const reschedule = migration.match(/create function public\.admin_reschedule_transport_departure\([\s\S]*?\$\$;/i)?.[0] ?? ''

test('reschedule is permission-checked, serialized, and limited to future scheduled departures', () => {
  assert.match(reschedule, /current_user_has_permission\('routes\.manage'\)/i)
  assert.match(reschedule, /pg_advisory_xact_lock/i)
  assert.match(reschedule, /for update/i)
  assert.match(reschedule, /v_departure\.status <> 'scheduled'/i)
  assert.match(reschedule, /p_travel_date < current_date/i)
})

test('reschedule retains the route and validates the replacement assignment and documents', () => {
  assert.match(reschedule, /vehicle_assignments/i)
  assert.match(reschedule, /vehicles v on v\.id = va\.vehicle_id and v\.status = 'active'/i)
  assert.match(reschedule, /driver_applications da[\s\S]*?da\.status = 'approved'/i)
  assert.match(reschedule, /vehicle_documents/i)
  assert.match(reschedule, /v_departure\.route_id/i)
  assert.doesNotMatch(reschedule, /set\s+route_id\s*=/i)
})

test('reschedule expires stale holds, prevents segment over-capacity, and rejects driver or vehicle conflicts', () => {
  assert.match(reschedule, /hold_expires_at <= v_now/i)
  assert.match(reschedule, /generate_series\(0, greatest/i)
  assert.match(reschedule, /pickup_stop_index <= segment\.stop_index/i)
  assert.match(reschedule, /dropoff_stop_index > segment\.stop_index/i)
  assert.match(reschedule, /v_capacity < v_peak_occupancy/i)
  assert.match(reschedule, /raise exception 'The selected vehicle has % seats, but this departure needs at least % seats on its busiest segment\.',\s*v_capacity, v_peak_occupancy/i)
  assert.match(reschedule, /d\.driver_user_id = p_driver_user_id or d\.vehicle_id = p_vehicle_id/i)
})

test('reschedule audits changes and limits its RPC to authenticated administrators', () => {
  assert.match(reschedule, /write_audit_log/i)
  assert.match(reschedule, /transport_departure\.rescheduled/i)
  assert.match(migration, /revoke all on function public\.admin_reschedule_transport_departure\(uuid, date, time, uuid, uuid\) from public, anon/i)
  assert.match(migration, /grant execute on function public\.admin_reschedule_transport_departure\(uuid, date, time, uuid, uuid\) to authenticated/i)
})
