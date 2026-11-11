import { getSupabaseClient } from './supabaseClient.ts'

export type VehicleStatus = 'active' | 'maintenance' | 'suspended' | 'retired'
export type VehicleDocumentType = 'registration' | 'insurance' | 'roadworthiness'
export type VehicleDocumentStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export interface Vehicle {
  id: string
  registration_number: string
  vehicle_type: string
  make: string
  model: string
  model_year: number
  seating_capacity: number
  status: VehicleStatus
  created_at: string
  updated_at: string
}

export interface VehicleDocument {
  id: string
  vehicle_id: string
  document_type: VehicleDocumentType
  object_path: string
  file_name: string
  content_type: string
  file_size_bytes: number
  expiry_date: string | null
  review_status: 'pending' | 'approved' | 'rejected'
  uploaded_at: string
  uploaded_by: string
  reviewed_at: string | null
}

export interface VehicleAssignment {
  id: string
  vehicle_id: string
  driver_user_id: string
  started_at: string
  ended_at: string | null
  driver_name: string
}

interface VehicleAssignmentHistoryRow {
  assignment_id: string
  vehicle_id: string
  driver_user_id: string
  started_at: string
  ended_at: string | null
  driver_name: string
}

export interface VehicleMaintenanceRecord {
  id: string
  vehicle_id: string
  service_type: string
  notes: string
  maintenance_date: string
  next_due_date: string | null
  status: MaintenanceStatus
  created_at: string
}

export interface EligibleDriver {
  driver_user_id: string
  full_name: string
}

export interface AssignedVehicleDocumentStatus {
  vehicle_id: string
  registration_number: string
  vehicle_type: string
  make: string
  model: string
  model_year: number
  seating_capacity: number
  vehicle_status: VehicleStatus
  document_type: VehicleDocumentType
  expiry_date: string | null
  document_status: 'missing' | VehicleDocumentStatus
}

export interface VehicleInput {
  registrationNumber: string
  vehicleType: string
  make: string
  model: string
  modelYear: number
  seatingCapacity: number
  status: VehicleStatus
}

export interface VehicleDocumentInput {
  vehicleId: string
  documentType: VehicleDocumentType
  file: File
  expiryDate: string | null
}

export interface MaintenanceInput {
  vehicleId: string
  serviceType: string
  notes: string
  maintenanceDate: string
  nextDueDate: string | null
  status: MaintenanceStatus
}

const allowedDocumentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const maximumDocumentSize = 10 * 1024 * 1024

function throwOnError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

export function isFleetSchemaUnavailable(error: unknown): boolean {
  return error instanceof Error && /relation .* does not exist|could not find the table|schema cache/i.test(error.message)
}

export const fleetService = {
  async listVehicles(): Promise<Vehicle[]> {
    const { data, error } = await getSupabaseClient()
      .from('vehicles')
      .select('id, registration_number, vehicle_type, make, model, model_year, seating_capacity, status, created_at, updated_at')
      .order('registration_number')
    throwOnError(error, 'Could not load vehicles')
    return data ?? []
  },

  async listEligibleDrivers(): Promise<EligibleDriver[]> {
    const { data, error } = await getSupabaseClient().rpc('list_eligible_vehicle_drivers')
    throwOnError(error, 'Could not load eligible drivers')
    return data ?? []
  },

  async getVehicleDetails(vehicleId: string) {
    const client = getSupabaseClient()
    const [documentsResult, assignmentsResult, maintenanceResult] = await Promise.all([
      client.from('vehicle_documents')
        .select('id, vehicle_id, document_type, object_path, file_name, content_type, file_size_bytes, expiry_date, review_status, uploaded_at, uploaded_by, reviewed_at')
        .eq('vehicle_id', vehicleId)
        .order('uploaded_at', { ascending: false }),
      client.rpc('get_vehicle_assignment_history', { p_vehicle_id: vehicleId }),
      client.from('vehicle_maintenance_records')
        .select('id, vehicle_id, service_type, notes, maintenance_date, next_due_date, status, created_at')
        .eq('vehicle_id', vehicleId)
        .order('maintenance_date', { ascending: false }),
    ])
    throwOnError(documentsResult.error, 'Could not load vehicle documents')
    throwOnError(assignmentsResult.error, 'Could not load assignment history')
    throwOnError(maintenanceResult.error, 'Could not load maintenance history')

    return {
      documents: (documentsResult.data ?? []) as VehicleDocument[],
      assignments: ((assignmentsResult.data ?? []) as VehicleAssignmentHistoryRow[]).map((assignment) => ({
        id: assignment.assignment_id,
        vehicle_id: assignment.vehicle_id,
        driver_user_id: assignment.driver_user_id,
        started_at: assignment.started_at,
        ended_at: assignment.ended_at,
        driver_name: assignment.driver_name,
      })) as VehicleAssignment[],
      maintenance: (maintenanceResult.data ?? []) as VehicleMaintenanceRecord[],
    }
  },

  async createVehicle(input: VehicleInput): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc('create_vehicle', {
      p_registration_number: input.registrationNumber,
      p_vehicle_type: input.vehicleType,
      p_make: input.make,
      p_model: input.model,
      p_model_year: input.modelYear,
      p_seating_capacity: input.seatingCapacity,
      p_status: input.status,
    })
    throwOnError(error, 'Could not create vehicle')
    if (typeof data !== 'string') throw new Error('Could not create vehicle: the database returned no vehicle ID.')
    return data
  },

  async updateVehicle(vehicleId: string, input: VehicleInput): Promise<void> {
    const { error } = await getSupabaseClient().rpc('update_vehicle', {
      p_vehicle_id: vehicleId,
      p_registration_number: input.registrationNumber,
      p_vehicle_type: input.vehicleType,
      p_make: input.make,
      p_model: input.model,
      p_model_year: input.modelYear,
      p_seating_capacity: input.seatingCapacity,
      p_status: input.status,
    })
    throwOnError(error, 'Could not update vehicle')
  },

  async assignDriver(vehicleId: string, driverUserId: string | null): Promise<void> {
    const { error } = await getSupabaseClient().rpc('set_vehicle_assignment', {
      p_vehicle_id: vehicleId,
      p_driver_user_id: driverUserId,
    })
    throwOnError(error, driverUserId ? 'Could not assign driver' : 'Could not end vehicle assignment')
  },

  async uploadDocument({ vehicleId, documentType, file, expiryDate }: VehicleDocumentInput): Promise<void> {
    if (!allowedDocumentTypes.has(file.type)) {
      throw new Error('Upload a JPG, PNG, WebP, or PDF vehicle document.')
    }
    if (file.size <= 0 || file.size > maximumDocumentSize) {
      throw new Error('The vehicle document must be 10 MB or smaller.')
    }
    if (documentType !== 'registration' && !expiryDate) {
      throw new Error('An expiry date is required for insurance and roadworthiness documents.')
    }

    const extension = file.type === 'application/pdf'
      ? 'pdf'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'jpg'
    const objectPath = `${vehicleId}/${documentType}/${crypto.randomUUID()}.${extension}`
    const client = getSupabaseClient()
    const { error: uploadError } = await client.storage
      .from('vehicle-documents')
      .upload(objectPath, file, { contentType: file.type, upsert: false })
    throwOnError(uploadError, 'Could not securely upload vehicle document')

    const fileName = file.name.split(/[\\/]/).pop()?.trim().slice(0, 255) || `vehicle-document.${extension}`
    const { error: registerError } = await client.rpc('create_vehicle_document', {
      p_vehicle_id: vehicleId,
      p_document_type: documentType,
      p_object_path: objectPath,
      p_file_name: fileName,
      p_content_type: file.type,
      p_file_size_bytes: file.size,
      p_expiry_date: expiryDate,
    })

    if (registerError) {
      const { error: cleanupError } = await client.storage.from('vehicle-documents').remove([objectPath])
      if (cleanupError) {
        throw new Error(
          `Could not register vehicle document: ${registerError.message}. The private upload could not be removed: ${cleanupError.message}`,
        )
      }
      throw new Error(`Could not register vehicle document: ${registerError.message}`)
    }
  },

  async createDocumentUrl(objectPath: string): Promise<string> {
    const { data, error } = await getSupabaseClient()
      .storage.from('vehicle-documents')
      .createSignedUrl(objectPath, 60)
    throwOnError(error, 'Could not create a secure document link')
    if (!data?.signedUrl) throw new Error('Could not create a secure document link.')
    return data.signedUrl
  },

  async reviewDocument(documentId: string, approved: boolean): Promise<void> {
    const { error } = await getSupabaseClient().rpc('review_vehicle_document', {
      p_document_id: documentId,
      p_approved: approved,
    })
    throwOnError(error, approved ? 'Could not approve vehicle document' : 'Could not reject vehicle document')
  },

  async createMaintenanceRecord(input: MaintenanceInput): Promise<void> {
    const { error } = await getSupabaseClient().rpc('create_vehicle_maintenance_record', {
      p_vehicle_id: input.vehicleId,
      p_service_type: input.serviceType,
      p_notes: input.notes,
      p_maintenance_date: input.maintenanceDate,
      p_next_due_date: input.nextDueDate,
      p_status: input.status,
    })
    throwOnError(error, 'Could not create maintenance record')
  },

  async updateMaintenanceRecord(recordId: string, status: MaintenanceStatus, nextDueDate: string | null): Promise<void> {
    const { error } = await getSupabaseClient().rpc('update_vehicle_maintenance_record', {
      p_record_id: recordId,
      p_status: status,
      p_next_due_date: nextDueDate,
    })
    throwOnError(error, 'Could not update maintenance record')
  },

  async getMyAssignedVehicleSummary(): Promise<AssignedVehicleDocumentStatus[]> {
    const { data, error } = await getSupabaseClient().rpc('get_my_assigned_vehicle_summary')
    throwOnError(error, 'Could not load assigned vehicle information')
    return data ?? []
  },
}
