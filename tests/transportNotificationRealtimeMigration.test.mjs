import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112130000_transport_notification_realtime.sql', import.meta.url),
  'utf8',
)

test('Realtime publication adds only the existing private notifications table and is safe to rerun', () => {
  assert.match(migration, /to_regclass\('public\.transport_notifications'\)/i)
  assert.match(migration, /pg_catalog\.pg_publication where pubname = 'supabase_realtime'/i)
  assert.match(migration, /pg_catalog\.pg_publication_tables/i)
  assert.match(migration, /tablename = 'transport_notifications'/i)
  assert.match(migration, /execute 'alter publication supabase_realtime add table public\.transport_notifications'/i)
  assert.match(migration, /if not exists/i)
  assert.match(migration, /notification polling remains available/i)
})
