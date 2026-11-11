import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const baseMigration = readFileSync(
  new URL('../supabase/migrations/20261109150000_auth_access_foundation.sql', import.meta.url),
  'utf8',
)
const onboardingMigration = readFileSync(
  new URL('../supabase/migrations/20261109210000_driver_onboarding_documents.sql', import.meta.url),
  'utf8',
)

test('driver onboarding migration extends the existing application schema', () => {
  assert.match(baseMigration, /create table public\.driver_applications/i)
  assert.match(baseMigration, /experience_years integer not null/i)
  assert.match(baseMigration, /grant insert \(user_id, vehicle_type, experience_years\)/i)
  assert.match(onboardingMigration, /add column if not exists vehicle_registration_number text/i)
  assert.match(onboardingMigration, /grant insert \(vehicle_registration_number\)/i)
  assert.match(onboardingMigration, /create table if not exists public\.driver_application_documents/i)
  assert.match(onboardingMigration, /unique \(application_id, document_type\)/i)
})

test('driver documents remain private and reviewers use the assigned permission', () => {
  assert.match(baseMigration, /'driver-documents', 'driver-documents', false/i)
  assert.match(baseMigration, /driver_documents_read_owner_or_admin[\s\S]*?current_user_has_permission\('drivers\.approve'\)/i)
  assert.match(onboardingMigration, /driver_application_documents_read_owner_or_reviewer[\s\S]*?current_user_has_permission\('drivers\.approve'\)/i)
  assert.match(onboardingMigration, /driver_application_documents_insert_owner[\s\S]*?da\.user_id = auth\.uid\(\)[\s\S]*?da\.status = 'pending'/i)
})

test('driver review RPC blocks self-review and incomplete approvals, then audits decisions', () => {
  assert.match(onboardingMigration, /create or replace function public\.review_driver_application/i)
  assert.match(onboardingMigration, /current_user_has_permission\('drivers\.approve'\)/i)
  assert.match(onboardingMigration, /v_user_id = auth\.uid\(\)/i)
  assert.match(onboardingMigration, /if p_approved and \([\s\S]*?count\(distinct document_type\)[\s\S]*?\) <> 5/i)
  assert.match(onboardingMigration, /insert into public\.user_roles/i)
  assert.match(onboardingMigration, /public\.write_audit_log/i)
})
