import { getSupabaseClient } from './supabaseClient.ts'

export type AdminPersonRole = 'passenger' | 'driver' | 'staff'
export interface AdminPersonDetail {
  user_id: string
  user_email: string
  full_name: string | null
  phone: string | null
  account_status: string
  created_at: string
  identity_verified_at: string | null
  driver_application_status: string | null
  vehicle_type: string | null
  vehicle_registration_number: string | null
  experience_years: number | null
}
export interface AdminPersonDocument {
  id: string
  label: string
  status: string
  createdAt: string
  kind: 'identity' | 'driver'
  applicationId?: string
  documentType?: string
}

function throwOnError(error: { message: string } | null, action: string) {
  if (error) throw new Error(`${action}: ${error.message}`)
}

export const adminPeopleService = {
  async getDetail(userId: string, role: AdminPersonRole): Promise<AdminPersonDetail> {
    const { data, error } = await getSupabaseClient().rpc('admin_get_transport_person_detail', {
      p_target_user_id: userId,
      p_role: role,
    })
    throwOnError(error, 'Could not load account details')
    const detail = Array.isArray(data) ? data[0] : null
    if (!detail) throw new Error('No account details were returned.')
    return detail as AdminPersonDetail
  },

  async listDocuments(userId: string, role: AdminPersonRole, allowIdentity: boolean, allowDriver: boolean): Promise<AdminPersonDocument[]> {
    const client = getSupabaseClient()
    const documents: AdminPersonDocument[] = []
    if (role === 'passenger' && allowIdentity) {
      const { data, error } = await client.from('identity_verifications')
        .select('id, status, created_at').eq('user_id', userId).order('created_at', { ascending: false })
      throwOnError(error, 'Could not load identity document list')
      for (const row of data ?? []) documents.push({ id: row.id, label: 'Identity document', status: row.status, createdAt: row.created_at, kind: 'identity' })
    }
    if (role === 'driver' && allowDriver) {
      const { data: applications, error: appsError } = await client.from('driver_applications')
        .select('id, created_at, status').eq('user_id', userId).order('created_at', { ascending: false })
      throwOnError(appsError, 'Could not load Driver application documents')
      const applicationIds = (applications ?? []).map((application) => application.id)
      if (applicationIds.length) {
        const appStatus = new Map((applications ?? []).map((application) => [application.id, application.status]))
        const { data, error } = await client.from('driver_application_documents')
          .select('application_id, document_type, created_at').in('application_id', applicationIds).eq('user_id', userId)
          .order('created_at', { ascending: false })
        throwOnError(error, 'Could not load Driver document list')
        for (const row of data ?? []) documents.push({
          id: `${row.application_id}:${row.document_type}`,
          applicationId: row.application_id,
          documentType: row.document_type,
          label: row.document_type.replaceAll('_', ' '),
          status: appStatus.get(row.application_id) ?? 'unavailable',
          createdAt: row.created_at,
          kind: 'driver',
        })
      }
    }
    return documents
  },

  async updateContact(userId: string, role: AdminPersonRole, fullName: string, phone: string) {
    const { error } = await getSupabaseClient().rpc('admin_update_person_contact', {
      p_target_user_id: userId,
      p_role: role,
      p_full_name: fullName,
      p_phone: phone,
    })
    throwOnError(error, 'Could not update account details')
  },

  async sendPasswordReset(email: string) {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    throwOnError(error, 'Could not send the password reset email')
  },
}
