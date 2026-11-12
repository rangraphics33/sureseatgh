import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient.ts'
import type { SureSeatRole } from '../features/auth/access.ts'

export type VerificationStatus = 'pending' | 'approved' | 'rejected'

export interface PendingIdentityVerification {
  id: string
  userId: string
  createdAt: string
}

export interface IdentityVerificationReviewResult {
  auditVerified: boolean
  auditError?: string
}

export type DriverDocumentType =
  | 'ghana_card'
  | 'drivers_license'
  | 'vehicle_registration'
  | 'insurance'
  | 'driver_photo'

export interface DriverApplicationInput {
  vehicleType: string
  vehicleRegistrationNumber: string
  experienceYears: number
  documents: Record<DriverDocumentType, File>
}

export interface DriverApplicationDocument {
  type: DriverDocumentType
  createdAt: string
}

export interface PendingDriverApplication {
  id: string
  userId: string
  fullName: string | null
  phone: string | null
  vehicleType: string
  vehicleRegistrationNumber: string
  experienceYears: number
  createdAt: string
  documents: DriverApplicationDocument[]
}

export interface DriverApplicationReviewResult {
  auditVerified: boolean
  auditError?: string
}

export interface AuthProfile {
  id: string
  full_name: string | null
  phone: string | null
  account_status: 'active' | 'restricted'
  verification_deadline_at: string
  identity_verified_at: string | null
}

export interface AuthSnapshot {
  user: User
  session: Session
  profile: AuthProfile
  identityVerificationStatus: VerificationStatus | null
  roles: SureSeatRole[]
  permissions: string[]
  driverApplicationStatus: VerificationStatus | null
}

const validRoles = new Set<SureSeatRole>([
  'passenger',
  'driver',
  'administrator',
  'super_admin',
  'staff',
])

function assertRole(value: string): SureSeatRole {
  if (!validRoles.has(value as SureSeatRole)) {
    throw new Error(`The account has an unsupported SureSeat role: ${value}.`)
  }
  return value as SureSeatRole
}

function throwOnSupabaseError(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

async function assertIdentityReviewPermission(client: ReturnType<typeof getSupabaseClient>) {
  const { data, error } = await client.rpc('current_user_has_permission', {
    p_permission_code: 'verification.review',
  })
  throwOnSupabaseError(error, 'Could not verify identity-review permission')
  if (data !== true) throw new Error('Your account does not have the verification.review permission.')
}

const driverDocumentTypes: DriverDocumentType[] = [
  'ghana_card',
  'drivers_license',
  'vehicle_registration',
  'insurance',
  'driver_photo',
]

async function assertDriverReviewPermission(client: ReturnType<typeof getSupabaseClient>) {
  const { data, error } = await client.rpc('current_user_has_permission', {
    p_permission_code: 'drivers.approve',
  })
  throwOnSupabaseError(error, 'Could not verify driver-review permission')
  if (data !== true) throw new Error('Your account does not have the drivers.approve permission.')
}

export const sureSeatAuth = {
  async updateOwnProfile(input: { fullName: string; phone: string }) {
    const fullName = input.fullName.trim()
    const phone = input.phone.trim()
    if (!fullName || fullName.length > 120) throw new Error('Enter a name between 1 and 120 characters.')
    if (phone.length > 30) throw new Error('Phone number must be 30 characters or fewer.')
    const client = getSupabaseClient()
    const { data, error } = await client.auth.getUser()
    throwOnSupabaseError(error, 'Could not validate the current account')
    if (!data.user) throw new Error('Sign in before updating your profile.')
    const { error: updateError } = await client.from('profiles')
      .update({ full_name: fullName, phone: phone || null })
      .eq('id', data.user.id)
    throwOnSupabaseError(updateError, 'Could not save your profile')
  },
  async signUp(email: string, password: string, fullName: string, returnTo?: string | null) {
    const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')
      ? returnTo
      : null
    const { data, error } = await getSupabaseClient().auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback${safeReturnTo ? `?next=${encodeURIComponent(safeReturnTo)}` : ''}`,
      },
    })
    throwOnSupabaseError(error, 'Could not create the account')
    return data
  },

  async signIn(email: string, password: string) {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    throwOnSupabaseError(error, 'Could not sign in')
    return data
  },

  async signOut() {
    const { error } = await getSupabaseClient().auth.signOut()
    throwOnSupabaseError(error, 'Could not sign out')
  },

  async requestPasswordReset(email: string) {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/reset-password` },
    )
    throwOnSupabaseError(error, 'Could not request a password reset')
  },

  async updatePassword(password: string) {
    const { error } = await getSupabaseClient().auth.updateUser({ password })
    throwOnSupabaseError(error, 'Could not update the password')
  },

  async submitIdentityVerification(file: File) {
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'application/pdf'])
    const maxBytes = 10 * 1024 * 1024
    if (!allowedTypes.has(file.type)) {
      throw new Error('Upload a JPG, PNG, or PDF document.')
    }
    if (file.size <= 0 || file.size > maxBytes) {
      throw new Error('The document must be 10 MB or smaller.')
    }

    const client = getSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    throwOnSupabaseError(userError, 'Could not validate the current account')
    const user = userData.user
    if (!user) throw new Error('Sign in before submitting identity documents.')

    const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
    const objectPath = `${user.id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await client.storage
      .from('identity-documents')
      .upload(objectPath, file, { contentType: file.type, upsert: false })
    throwOnSupabaseError(uploadError, 'Could not securely upload the identity document')

    const { error: insertError } = await client.from('identity_verifications').insert({
      user_id: user.id,
      document_object_path: objectPath,
    })

    if (insertError) {
      const { error: cleanupError } = await client.storage.from('identity-documents').remove([objectPath])
      if (cleanupError) {
        throw new Error(
          `Could not submit identity verification: ${insertError.message}. The uploaded private document could not be removed: ${cleanupError.message}`,
        )
      }
      throw new Error(`Could not submit identity verification: ${insertError.message}`)
    }
  },

  async listPendingIdentityVerifications(): Promise<PendingIdentityVerification[]> {
    const client = getSupabaseClient()
    await assertIdentityReviewPermission(client)

    const { data, error } = await client.from('identity_verifications')
      .select('id, user_id, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    throwOnSupabaseError(error, 'Could not load pending identity verifications')
    if (!data?.length) return []

    return data.map((record) => {
      return {
        id: record.id,
        userId: record.user_id,
        createdAt: record.created_at,
      }
    })
  },

  async createIdentityVerificationDocumentUrl(
    verificationId: string,
  ): Promise<{ url: string; contentType: 'application/pdf' | 'image' }> {
    const client = getSupabaseClient()
    await assertIdentityReviewPermission(client)
    const { data: userData, error: userError } = await client.auth.getUser()
    throwOnSupabaseError(userError, 'Could not validate the reviewing account')
    if (!userData.user) throw new Error('Sign in before viewing identity documents.')

    const { data, error } = await client.from('identity_verifications')
      .select('user_id, status, document_object_path')
      .eq('id', verificationId)
      .maybeSingle()
    throwOnSupabaseError(error, 'Could not load the verification document reference')
    if (!data) throw new Error('The identity verification record is no longer available.')

    const path = data.document_object_path
    if (!path.startsWith(`${data.user_id}/`) || path.includes('..') || path.includes('\\')) {
      throw new Error('The stored document path is invalid. The document was not opened.')
    }

    const { data: signedData, error: signedError } = await client.storage
      .from('identity-documents')
      .createSignedUrl(path, 60)
    throwOnSupabaseError(signedError, 'Could not securely open the private identity document')
    if (!signedData?.signedUrl) throw new Error('Supabase did not return a secure document URL.')
    return {
      url: signedData.signedUrl,
      contentType: path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image',
    }
  },

  async reviewIdentityVerification(
    verificationId: string,
    approved: boolean,
  ): Promise<IdentityVerificationReviewResult> {
    const client = getSupabaseClient()
    await assertIdentityReviewPermission(client)
    const { data: reviewerData, error: reviewerError } = await client.auth.getUser()
    throwOnSupabaseError(reviewerError, 'Could not validate the reviewing account')
    const reviewer = reviewerData.user
    if (!reviewer) throw new Error('Sign in before reviewing identity verifications.')

    const { data: target, error: targetError } = await client.from('identity_verifications')
      .select('user_id, status')
      .eq('id', verificationId)
      .maybeSingle()
    throwOnSupabaseError(targetError, 'Could not load the verification record')
    if (!target || target.status !== 'pending') {
      throw new Error('This verification has already been reviewed or is no longer available.')
    }
    if (target.user_id === reviewer.id) {
      throw new Error('You cannot review your own identity verification.')
    }

    const { error } = await client.rpc('review_identity_verification', {
      p_verification_id: verificationId,
      p_approved: approved,
    })
    throwOnSupabaseError(error, `Could not ${approved ? 'approve' : 'reject'} the identity verification`)

    const expectedAction = approved
      ? 'identity_verification.approved'
      : 'identity_verification.rejected'
    const { data: auditEntry, error: auditError } = await client.from('audit_logs')
      .select('id')
      .eq('actor_id', reviewer.id)
      .eq('subject_user_id', target.user_id)
      .eq('action', expectedAction)
      .contains('details', { verification_id: verificationId })
      .limit(1)
      .maybeSingle()

    if (auditError) {
      return {
        auditVerified: false,
        auditError: `Review completed, but its audit record could not be verified: ${auditError.message}`,
      }
    }
    if (!auditEntry) {
      return {
        auditVerified: false,
        auditError: 'Review completed, but the expected audit record was not found. Contact a platform administrator.',
      }
    }
    return { auditVerified: true }
  },

  async getCurrentState(): Promise<AuthSnapshot | null> {
    const client = getSupabaseClient()
    const { data: sessionData, error: sessionError } = await client.auth.getSession()
    throwOnSupabaseError(sessionError, 'Could not restore the session')
    const session = sessionData.session
    if (!session) return null

    const { data: userData, error: userError } = await client.auth.getUser(session.access_token)
    throwOnSupabaseError(userError, 'Could not validate the current session')
    const user = userData.user
    if (!user) throw new Error('Supabase returned a session without a verified user.')

    const [profileResult, rolesResult] = await Promise.all([
      client.from('profiles')
        .select('id, full_name, phone, account_status, verification_deadline_at, identity_verified_at')
        .eq('id', user.id)
        .maybeSingle(),
      client.from('user_roles')
        .select('role')
        .eq('user_id', user.id),
    ])
    throwOnSupabaseError(profileResult.error, 'Could not load the account profile')
    throwOnSupabaseError(rolesResult.error, 'Could not verify account roles')

    const profile = profileResult.data as AuthProfile | null
    if (!profile || profile.id !== user.id || !profile.verification_deadline_at) {
      throw new Error('The account profile is missing or incomplete. Access is blocked until it is repaired.')
    }

    const roles = [...new Set((rolesResult.data ?? []).map((row) => assertRole(row.role)))]
    if (!roles.length) throw new Error('No SureSeat role is assigned to this account.')

    const { data: verificationData, error: verificationError } = await client
      .from('identity_verifications')
      .select('status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwOnSupabaseError(verificationError, 'Could not load identity verification status')
    const identityVerificationStatus = verificationData
      && ['pending', 'approved', 'rejected'].includes(verificationData.status)
      ? verificationData.status as VerificationStatus
      : null

    let permissions: string[] = []
    if (roles.includes('staff')) {
      const { data, error } = await client.from('staff_permission_assignments')
        .select('permission_code')
        .eq('staff_user_id', user.id)
      throwOnSupabaseError(error, 'Could not verify staff permissions')
      permissions = [...new Set((data ?? []).map((row) => row.permission_code))]
    }

    let driverApplicationStatus: VerificationStatus | null = null
    if (roles.includes('driver')) {
      const { data, error } = await client.from('driver_applications')
        .select('status')
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle()
      throwOnSupabaseError(error, 'Could not verify driver approval')
      if (data?.status === 'approved') driverApplicationStatus = 'approved'
      else throw new Error('The Driver role has no approved driver application.')
    } else {
      const { data, error } = await client.from('driver_applications')
        .select('status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      throwOnSupabaseError(error, 'Could not load driver application status')
      if (data && ['pending', 'rejected', 'approved'].includes(data.status)) {
        driverApplicationStatus = data.status as VerificationStatus
      }
    }

    return {
      user,
      session,
      profile,
      identityVerificationStatus,
      roles,
      permissions,
      driverApplicationStatus,
    }
  },

  async submitDriverApplication(input: DriverApplicationInput) {
    const client = getSupabaseClient()
    const { data: userData, error: userError } = await client.auth.getUser()
    throwOnSupabaseError(userError, 'Could not validate the current account')
    const user = userData.user
    if (!user) throw new Error('Sign in before applying to become a Driver.')

    if (!input.vehicleType.trim() || !input.vehicleRegistrationNumber.trim()) {
      throw new Error('Enter the vehicle type and registration number.')
    }
    if (!Number.isInteger(input.experienceYears) || input.experienceYears < 0 || input.experienceYears > 80) {
      throw new Error('Enter valid driving experience between 0 and 80 years.')
    }
    for (const type of driverDocumentTypes) {
      const file = input.documents[type]
      if (!file) throw new Error(`Please attach your ${type.replaceAll('_', ' ')}.`)
      const allowedTypes = type === 'driver_photo'
        ? ['image/jpeg', 'image/png', 'image/webp']
        : ['image/jpeg', 'image/png', 'application/pdf']
      if (!allowedTypes.includes(file.type)) {
        throw new Error(`Unsupported file type for ${type.replaceAll('_', ' ')}.`)
      }
      if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
        throw new Error('Each document must be greater than 0 bytes and no larger than 10 MB.')
      }
    }

    const { data: application, error: applicationError } = await client.from('driver_applications')
      .insert({
        user_id: user.id,
        vehicle_type: input.vehicleType.trim(),
        vehicle_registration_number: input.vehicleRegistrationNumber.trim().toUpperCase(),
        experience_years: input.experienceYears,
      })
      .select('id')
      .single()
    throwOnSupabaseError(applicationError, 'Could not create the Driver application')
    if (!application?.id) throw new Error('The Driver application was created without an ID.')

    for (const type of driverDocumentTypes) {
      const file = input.documents[type]
      const extension = file.type === 'application/pdf' ? 'pdf'
        : file.type === 'image/png' ? 'png'
          : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${user.id}/${application.id}/${type}-${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await client.storage.from('driver-documents')
        .upload(path, file, { contentType: file.type, upsert: false })
      throwOnSupabaseError(uploadError, `Could not upload ${type.replaceAll('_', ' ')}`)

      const { error: documentError } = await client.from('driver_application_documents').insert({
        application_id: application.id,
        user_id: user.id,
        document_type: type,
        object_path: path,
      })
      throwOnSupabaseError(documentError, `Could not save ${type.replaceAll('_', ' ')} reference`)
    }
  },

  async listPendingDriverApplications(): Promise<PendingDriverApplication[]> {
    const client = getSupabaseClient()
    await assertDriverReviewPermission(client)
    const { data, error } = await client.from('driver_applications')
      .select('id, user_id, vehicle_type, vehicle_registration_number, experience_years, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    throwOnSupabaseError(error, 'Could not load pending Driver applications')
    if (!data?.length) return []

    const { data: directory, error: directoryError } = await client.rpc('admin_list_transport_people', { p_role: 'driver' })
    throwOnSupabaseError(directoryError, 'Could not load Driver applicant details')
    const profileByUser = new Map<string, { user_id: string; full_name: string | null; phone: string | null }>((directory ?? []).map((person: { user_id: string; full_name: string | null; phone: string | null }) => [person.user_id, person]))

    const applicationIds = data.map((application) => application.id)
    const { data: documentRows, error: documentsError } = await client
      .from('driver_application_documents')
      .select('application_id, document_type, created_at')
      .in('application_id', applicationIds)
    throwOnSupabaseError(documentsError, 'Could not load Driver application document list')

    const documentsByApplication = new Map<string, DriverApplicationDocument[]>()
    for (const row of documentRows ?? []) {
      if (!driverDocumentTypes.includes(row.document_type as DriverDocumentType)) continue
      const documents = documentsByApplication.get(row.application_id) ?? []
      documents.push({
        type: row.document_type as DriverDocumentType,
        createdAt: row.created_at,
      })
      documentsByApplication.set(row.application_id, documents)
    }

    return data.map((application) => ({
      id: application.id,
      userId: application.user_id,
      fullName: profileByUser.get(application.user_id)?.full_name ?? null,
      phone: profileByUser.get(application.user_id)?.phone ?? null,
      vehicleType: application.vehicle_type,
      vehicleRegistrationNumber: application.vehicle_registration_number,
      experienceYears: application.experience_years,
      createdAt: application.created_at,
      documents: documentsByApplication.get(application.id) ?? [],
    }))
  },

  async createDriverApplicationDocumentUrl(
    applicationId: string,
    documentType: DriverDocumentType,
  ): Promise<{ url: string; contentType: 'application/pdf' | 'image' }> {
    const client = getSupabaseClient()
    await assertDriverReviewPermission(client)
    const { data: application, error: applicationError } = await client.from('driver_applications')
      .select('id, user_id, status')
      .eq('id', applicationId)
      .maybeSingle()
    throwOnSupabaseError(applicationError, 'Could not load the Driver application')
    if (!application) throw new Error('The Driver application is no longer available.')

    const { data: document, error: documentError } = await client.from('driver_application_documents')
      .select('object_path')
      .eq('application_id', applicationId)
      .eq('user_id', application.user_id)
      .eq('document_type', documentType)
      .maybeSingle()
    throwOnSupabaseError(documentError, 'Could not load the Driver document reference')
    if (!document) throw new Error('This required document was not submitted with the application.')

    const prefix = `${application.user_id}/${applicationId}/`
    if (!document.object_path.startsWith(prefix)
      || document.object_path.includes('..')
      || document.object_path.includes('\\')) {
      throw new Error('The stored document path is invalid. The document was not opened.')
    }
    const { data, error } = await client.storage.from('driver-documents')
      .createSignedUrl(document.object_path, 60)
    throwOnSupabaseError(error, 'Could not securely open the private Driver document')
    if (!data?.signedUrl) throw new Error('Supabase did not return a secure document URL.')
    return {
      url: data.signedUrl,
      contentType: document.object_path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image',
    }
  },

  async reviewDriverApplication(
    applicationId: string,
    approved: boolean,
  ): Promise<DriverApplicationReviewResult> {
    const client = getSupabaseClient()
    await assertDriverReviewPermission(client)
    const { data: reviewerData, error: reviewerError } = await client.auth.getUser()
    throwOnSupabaseError(reviewerError, 'Could not validate the reviewing account')
    const reviewer = reviewerData.user
    if (!reviewer) throw new Error('Sign in before reviewing Driver applications.')

    const { data: application, error: applicationError } = await client.from('driver_applications')
      .select('user_id, status')
      .eq('id', applicationId)
      .maybeSingle()
    throwOnSupabaseError(applicationError, 'Could not load the Driver application')
    if (!application || application.status !== 'pending') {
      throw new Error('This Driver application has already been reviewed or is no longer available.')
    }
    if (application.user_id === reviewer.id) {
      throw new Error('You cannot review your own Driver application.')
    }

    const { data: documentTypes, error: typesError } = await client.from('driver_application_documents')
      .select('document_type')
      .eq('application_id', applicationId)
      .eq('user_id', application.user_id)
    throwOnSupabaseError(typesError, 'Could not verify submitted Driver document types')
    const submittedTypes = new Set((documentTypes ?? []).map((document) => document.document_type))
    if (submittedTypes.size !== driverDocumentTypes.length
      || driverDocumentTypes.some((type) => !submittedTypes.has(type))) {
      throw new Error('The application is missing at least one of the five required Driver documents.')
    }

    const { error } = await client.rpc('review_driver_application', {
      p_application_id: applicationId,
      p_approved: approved,
    })
    throwOnSupabaseError(error, `Could not ${approved ? 'approve' : 'reject'} the Driver application`)

    const expectedAction = approved ? 'driver_application.approved' : 'driver_application.rejected'
    const { data: auditEntry, error: auditError } = await client.from('audit_logs')
      .select('id')
      .eq('actor_id', reviewer.id)
      .eq('subject_user_id', application.user_id)
      .eq('action', expectedAction)
      .contains('details', { application_id: applicationId })
      .limit(1)
      .maybeSingle()
    if (auditError) {
      return {
        auditVerified: false,
        auditError: `Review completed, but its audit record could not be verified: ${auditError.message}`,
      }
    }
    if (!auditEntry) {
      return {
        auditVerified: false,
        auditError: 'Review completed, but the expected audit record was not found. Contact a platform administrator.',
      }
    }
    return { auditVerified: true }
  },
}
