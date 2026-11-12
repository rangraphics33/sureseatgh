import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112140000_admin_people_directory.sql', import.meta.url),
  'utf8',
)

test('people directory uses existing profiles and roles with role-specific permission gates', () => {
  assert.match(migration, /create function public\.admin_list_transport_people\(p_role text\)/i)
  assert.match(migration, /public\.current_user_has_permission\('passengers\.read'\)/i)
  assert.match(migration, /public\.current_user_has_permission\('drivers\.read'\)/i)
  assert.match(migration, /from public\.user_roles ur/i)
  assert.match(migration, /from public\.profiles p/i)
  assert.match(migration, /left join lateral/i)
  assert.match(migration, /limit 500/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(migration, /revoke all on function public\.admin_list_transport_people\(text\) from public, anon/i)
  assert.doesNotMatch(migration, /create table/i)
})
