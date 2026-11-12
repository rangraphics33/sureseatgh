import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261112150000_admin_support_person_management.sql', import.meta.url),
  'utf8',
)

test('admin person detail RPC returns only one authorized person and includes auth email for support', () => {
  assert.match(migration, /admin_get_transport_person_detail\(\s*p_target_user_id uuid,\s*p_role text/i)
  assert.match(migration, /join auth\.users u on u\.id = p\.id/i)
  assert.match(migration, /where p\.id = p_target_user_id/i)
  assert.match(migration, /current_user_has_permission\('drivers\.read'\)/i)
  assert.match(migration, /current_user_has_permission\('support\.manage'\)/i)
  assert.match(migration, /set search_path = ''/i)
})

test('contact updates are permission checked and audited; reset authority is not added to SQL', () => {
  assert.match(migration, /admin_update_person_contact\(\s*p_target_user_id uuid,\s*p_role text,\s*p_full_name text,\s*p_phone text/i)
  assert.match(migration, /support\.person_contact_updated/i)
  assert.match(migration, /public\.write_audit_log/i)
  assert.match(migration, /revoke all on function public\.admin_update_person_contact\(uuid, text, text, text\) from public, anon/i)
  assert.doesNotMatch(migration, /update auth\.users|set encrypted_password|service_role/i)
})
