import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112110000_transport_notifications.sql', import.meta.url),
  'utf8',
)

test('transport notifications are private, recipient-scoped, and idempotent', () => {
  assert.match(migration, /create table public\.transport_notifications/i)
  assert.match(migration, /source_key text not null unique/i)
  assert.match(migration, /alter table public\.transport_notifications enable row level security/i)
  assert.match(migration, /using \(recipient_user_id = auth\.uid\(\)\)/i)
  assert.match(migration, /on conflict \(source_key\) do nothing/i)
  assert.match(migration, /revoke all on public\.transport_notifications from public, anon, authenticated/i)
})

test('existing transport event types generate recipient-specific in-app updates', () => {
  const handler = migration.match(/create function public\.notify_transport_event\(\)[\s\S]*?\$\$;/i)?.[0] ?? ''
  for (const event of [
    'boarding_verified',
    'passenger_completion_requested',
    'driver_completion_confirmed',
  ]) assert.match(handler, new RegExp(event, 'i'))
  assert.match(handler, /v_passenger_id/i)
  assert.match(handler, /v_driver_id/i)
  assert.match(migration, /after insert on public\.transport_events/i)
})

test('payment booking status and departure changes produce notices for affected passengers only', () => {
  const bookingHandler = migration.match(/create function public\.notify_transport_booking_status\(\)[\s\S]*?\$\$;/i)?.[0] ?? ''
  const departureHandler = migration.match(/create function public\.notify_transport_departure_change\(\)[\s\S]*?\$\$;/i)?.[0] ?? ''
  assert.match(bookingHandler, /new\.status = 'confirmed'/i)
  assert.match(bookingHandler, /new\.status = 'cancelled'/i)
  assert.match(bookingHandler, /new\.status = 'expired'/i)
  assert.match(departureHandler, /new\.status = 'cancelled'/i)
  assert.match(departureHandler, /old\.travel_date is distinct from new\.travel_date/i)
  assert.match(departureHandler, /b\.passenger_user_id/i)
  assert.match(departureHandler, /b\.status = 'confirmed'/i)
})

test('authenticated notification RPCs verify identity and only modify the caller’s own unread rows', () => {
  const list = migration.match(/create function public\.list_my_transport_notifications\(p_limit integer default 50\)[\s\S]*?\$\$;/i)?.[0] ?? ''
  const markRead = migration.match(/create function public\.mark_my_transport_notifications_read\(p_notification_ids uuid\[\] default null\)[\s\S]*?\$\$;/i)?.[0] ?? ''
  assert.match(list, /auth\.uid\(\) is null/i)
  assert.match(list, /n\.recipient_user_id = auth\.uid\(\)/i)
  assert.match(list, /p_limit < 1 or p_limit > 100/i)
  assert.match(markRead, /n\.recipient_user_id = auth\.uid\(\)/i)
  assert.match(markRead, /n\.read_at is null/i)
  assert.match(migration, /grant execute on function public\.list_my_transport_notifications\(integer\) to authenticated/i)
  assert.match(migration, /grant execute on function public\.mark_my_transport_notifications_read\(uuid\[\]\) to authenticated/i)
  assert.match(migration, /revoke all on function public\.list_my_transport_notifications\(integer\) from public, anon/i)
  assert.match(migration, /revoke all on function public\.mark_my_transport_notifications_read\(uuid\[\]\) from public, anon/i)
})
