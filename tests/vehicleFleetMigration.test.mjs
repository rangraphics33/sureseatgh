import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../supabase/migrations/20261109235000_vehicle_fleet_management.sql', import.meta.url),
  'utf8',
)

test('fleet migration defines normalized vehicles, private documents, assignments, and maintenance', () => {
  assert.match(migration, /create table public\.vehicles/i)
  assert.match(migration, /registration_number text not null unique/i)
  assert.match(migration, /create table public\.vehicle_documents/i)
  assert.match(migration, /object_path text not null unique/i)
  assert.match(migration, /create table public\.vehicle_assignments/i)
  assert.match(migration, /create unique index vehicle_assignments_one_active_vehicle_idx/i)
  assert.match(migration, /create unique index vehicle_assignments_one_active_driver_idx/i)
  assert.match(migration, /create table public\.vehicle_maintenance_records/i)
})

test('fleet rows, private storage, and RPC writes require vehicles.manage', () => {
  assert.match(migration, /vehicles_read_manager_or_assigned_driver[\s\S]*?current_user_has_permission\('vehicles\.manage'\)/i)
  assert.match(migration, /vehicle_documents_read_manager[\s\S]*?current_user_has_permission\('vehicles\.manage'\)/i)
  assert.match(migration, /vehicle_documents_storage_insert_manager[\s\S]*?current_user_has_permission\('vehicles\.manage'\)/i)
  assert.match(migration, /vehicle-documents',\s*'vehicle-documents',\s*false/i)
  assert.match(migration, /create or replace function public\.create_vehicle\([\s\S]*?current_user_has_permission\('vehicles\.manage'\)/i)
  assert.match(migration, /create or replace function public\.update_vehicle\([\s\S]*?current_user_has_permission\('vehicles\.manage'\)/i)
})

test('assignment RPC enforces active approved drivers, eligible vehicles, documents, and audit', () => {
  assert.match(migration, /create or replace function public\.set_vehicle_assignment/i)
  assert.match(migration, /da\.status = 'approved'/i)
  assert.match(migration, /p\.account_status = 'active'/i)
  assert.match(migration, /v_vehicle_status <> 'active'/i)
  assert.match(migration, /array\['registration', 'insurance', 'roadworthiness'\]/i)
  assert.match(migration, /v_document_status <> 'approved'/i)
  assert.match(migration, /v_document_type in \('insurance', 'roadworthiness'\)[\s\S]*?v_expiry_date < current_date/i)
  assert.match(migration, /vehicle\.assignment_reassigned/i)
  assert.match(migration, /public\.write_audit_log/i)
})

test('frontend and database use the same vehicle document types and assignment requirements', () => {
  const service = readFileSync(new URL('../src/services/fleet.ts', import.meta.url), 'utf8')
  const management = readFileSync(new URL('../src/features/admin/FleetManagement.tsx', import.meta.url), 'utf8')
  assert.match(service, /VehicleDocumentType = 'registration' \| 'insurance' \| 'roadworthiness'/)
  assert.match(management, /\['registration', 'insurance', 'roadworthiness'\]/)
  assert.match(migration, /check \(document_type in \('registration', 'insurance', 'roadworthiness'\)\)/i)
  assert.match(migration, /array\['registration', 'insurance', 'roadworthiness'\]/i)
  assert.match(management, /isCurrentApprovedDocument\(latestDocuments\.get\('registration'\), false\)/)
  assert.match(management, /isCurrentApprovedDocument\(latestDocuments\.get\('insurance'\), true\)/)
  assert.match(management, /isCurrentApprovedDocument\(latestDocuments\.get\('roadworthiness'\), true\)/)
})

test('drivers receive assigned vehicle metadata but not private object paths', () => {
  assert.match(migration, /create or replace function public\.get_my_assigned_vehicle_summary/i)
  assert.match(migration, /where va\.driver_user_id = auth\.uid\(\)[\s\S]*?va\.ended_at is null/i)
  assert.match(migration, /document_status text/i)
  assert.doesNotMatch(
    migration.slice(migration.indexOf('create or replace function public.get_my_assigned_vehicle_summary')),
    /object_path|file_name|reviewed_by/i,
  )
})

test('misleading hardcoded overview metrics are removed from the live admin dashboard', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const dashboard = readFileSync(new URL('../src/features/admin/AdminDashboard.tsx', import.meta.url), 'utf8')
  const dashboardService = readFileSync(new URL('../src/services/adminDashboard.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /Bookings today["']?,?\s*value="128"/)
  assert.doesNotMatch(app, /Active drivers["']?,?\s*value="42"/)
  assert.doesNotMatch(app, /Trips in progress["']?,?\s*value="8"/)
  assert.match(dashboard, /Not connected/)
  assert.match(dashboardService, /Live count from Supabase/)
})
