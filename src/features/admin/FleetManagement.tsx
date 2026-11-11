import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bus, CheckCircle2, Clock3, FileCheck2, Plus, Search, ShieldCheck, Wrench } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import {
  fleetService,
  isFleetSchemaUnavailable,
  type AssignedVehicleDocumentStatus,
  type EligibleDriver,
  type MaintenanceStatus,
  type Vehicle,
  type VehicleDocument,
  type VehicleDocumentType,
  type VehicleInput,
  type VehicleMaintenanceRecord,
  type VehicleStatus,
} from '../../services/fleet.ts'

const initialVehicleForm: VehicleInput = {
  registrationNumber: '',
  vehicleType: 'minibus',
  make: '',
  model: '',
  modelYear: new Date().getFullYear(),
  seatingCapacity: 1,
  status: 'active',
}

function localDate() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function displayDate(value: string | null) {
  if (!value) return 'No expiry date'
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function documentStatus(document: VehicleDocument) {
  if (!document.expiry_date) return document.review_status
  const today = new Date(`${localDate()}T00:00:00`)
  const expiry = new Date(`${document.expiry_date}T00:00:00`)
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000)
  if (daysUntilExpiry < 0) return 'expired'
  if (document.review_status === 'approved' && daysUntilExpiry <= 30) return 'expiring-soon'
  return document.review_status
}

function isCurrentApprovedDocument(document: VehicleDocument | undefined, requiresExpiry: boolean) {
  return !!document && document.review_status === 'approved'
    && (!requiresExpiry || (!!document.expiry_date && document.expiry_date >= localDate()))
}

function PageTitle({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="page-title"><div><p className="eyebrow">ADMIN · FLEET</p><h1>{title}</h1><p className="muted">{detail}</p></div>{action}</div>
}

export default function FleetManagement({ isSupabaseMode }: { isSupabaseMode: boolean }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<EligibleDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [driverError, setDriverError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | VehicleStatus>('all')
  const [reloadKey, setReloadKey] = useState(0)
  const [detailsReloadKey, setDetailsReloadKey] = useState(0)
  const [documents, setDocuments] = useState<VehicleDocument[]>([])
  const [assignments, setAssignments] = useState<Awaited<ReturnType<typeof fleetService.getVehicleDetails>>['assignments']>([])
  const [maintenance, setMaintenance] = useState<VehicleMaintenanceRecord[]>([])
  const [detailsLoading, setDetailsLoading] = useState(true)
  const [detailsError, setDetailsError] = useState('')
  const [vehicleForm, setVehicleForm] = useState<VehicleInput>(initialVehicleForm)
  const [editingVehicle, setEditingVehicle] = useState(false)
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false)
  const [assignmentDriverId, setAssignmentDriverId] = useState('')
  const [documentType, setDocumentType] = useState<VehicleDocumentType>('registration')
  const [documentFile, setDocumentFile] = useState<File | null>(null)
  const [documentExpiry, setDocumentExpiry] = useState('')
  const [maintenanceForm, setMaintenanceForm] = useState({
    serviceType: '',
    notes: '',
    maintenanceDate: localDate(),
    nextDueDate: '',
    status: 'scheduled' as MaintenanceStatus,
  })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [actionError, setActionError] = useState('')
  const [signedLinks, setSignedLinks] = useState<Record<string, string>>({})

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null
  const filteredVehicles = useMemo(() => vehicles.filter((vehicle) => {
    const matchesText = `${vehicle.registration_number} ${vehicle.vehicle_type} ${vehicle.make} ${vehicle.model}`
      .toLowerCase().includes(search.toLowerCase())
    return matchesText && (statusFilter === 'all' || vehicle.status === statusFilter)
  }), [search, statusFilter, vehicles])
  const latestDocuments = useMemo(() => {
    const latest = new Map<VehicleDocumentType, VehicleDocument>()
    for (const document of documents) {
      if (!latest.has(document.document_type)) latest.set(document.document_type, document)
    }
    return latest
  }, [documents])
  const activeAssignment = assignments.find((assignment) => assignment.ended_at === null)
  const requiredDocumentsCurrent = isCurrentApprovedDocument(latestDocuments.get('registration'), false)
    && isCurrentApprovedDocument(latestDocuments.get('insurance'), true)
    && isCurrentApprovedDocument(latestDocuments.get('roadworthiness'), true)

  useEffect(() => {
    if (!isSupabaseMode) return
    let active = true
    void Promise.allSettled([fleetService.listVehicles(), fleetService.listEligibleDrivers()])
      .then(([vehicleResult, driverResult]) => {
        if (!active) return
        if (vehicleResult.status === 'fulfilled') {
          setListError('')
          setVehicles(vehicleResult.value)
          setSelectedId((current) => vehicleResult.value.some((vehicle) => vehicle.id === current)
            ? current
            : vehicleResult.value[0]?.id ?? '')
          if (!vehicleResult.value.length) setDetailsLoading(false)
        } else {
          setVehicles([])
          setListError(vehicleResult.reason instanceof Error
            ? vehicleResult.reason.message
            : 'Could not load vehicles.')
        }
        if (driverResult.status === 'fulfilled') {
          setDriverError('')
          setDrivers(driverResult.value)
        } else setDriverError(driverResult.reason instanceof Error
          ? driverResult.reason.message
          : 'Could not load eligible drivers.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isSupabaseMode, reloadKey])

  useEffect(() => {
    if (!isSupabaseMode || !selectedId) return
    let active = true
    void fleetService.getVehicleDetails(selectedId).then((details) => {
      if (!active) return
      setDetailsError('')
      setDocuments(details.documents)
      setAssignments(details.assignments)
      setMaintenance(details.maintenance)
      setAssignmentDriverId(details.assignments.find((assignment) => assignment.ended_at === null)?.driver_user_id ?? '')
      setSignedLinks({})
    }).catch((error: unknown) => {
      if (!active) return
      setDetailsError(error instanceof Error ? error.message : 'Could not load vehicle details.')
    }).finally(() => { if (active) setDetailsLoading(false) })
    return () => { active = false }
  }, [detailsReloadKey, isSupabaseMode, selectedId])

  async function refreshAll() {
    setLoading(true)
    setDetailsLoading(true)
    setDetailsError('')
    setReloadKey((key) => key + 1)
    setDetailsReloadKey((key) => key + 1)
  }

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setBusy(true)
    setActionError('')
    setFeedback('')
    try {
      await action()
      setFeedback(successMessage)
      await refreshAll()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The requested fleet action failed.')
    } finally {
      setBusy(false)
    }
  }

  async function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction(async () => {
      if (editingVehicle && selectedVehicle) {
        await fleetService.updateVehicle(selectedVehicle.id, vehicleForm)
      } else {
        const vehicleId = await fleetService.createVehicle(vehicleForm)
        setSelectedId(vehicleId)
      }
      setVehicleFormOpen(false)
      setEditingVehicle(false)
      setVehicleForm(initialVehicleForm)
    }, editingVehicle ? 'Vehicle details updated.' : 'Vehicle registered.')
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedVehicle || !documentFile) return
    const form = event.currentTarget
    await runAction(async () => {
      await fleetService.uploadDocument({
        vehicleId: selectedVehicle.id,
        documentType,
        file: documentFile,
        expiryDate: documentType === 'registration' ? documentExpiry || null : documentExpiry,
      })
      setDocumentFile(null)
      setDocumentExpiry('')
      form.reset()
    }, 'Private vehicle document uploaded and submitted for review.')
  }

  async function submitMaintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedVehicle) return
    await runAction(async () => {
      await fleetService.createMaintenanceRecord({
        vehicleId: selectedVehicle.id,
        serviceType: maintenanceForm.serviceType,
        notes: maintenanceForm.notes,
        maintenanceDate: maintenanceForm.maintenanceDate,
        nextDueDate: maintenanceForm.nextDueDate || null,
        status: maintenanceForm.status,
      })
      setMaintenanceForm({
        serviceType: '',
        notes: '',
        maintenanceDate: localDate(),
        nextDueDate: '',
        status: 'scheduled',
      })
    }, 'Maintenance record added.')
  }

  if (!isSupabaseMode) {
    return <><PageTitle title="Vehicle & fleet management" detail="Fleet records are never simulated or shown as live preview data." />
      <div className="panel"><div className="empty-state"><div className="empty-icon"><Bus /></div><h3>Fleet management requires Supabase mode</h3><p>No sample vehicles, driver assignments, or documents are displayed in preview mode.</p></div></div>
    </>
  }

  return (
    <>
      <PageTitle
        title="Vehicle & fleet management"
        detail="Manage registered vehicles, private compliance documents, driver assignments, and maintenance."
        action={<button className="button button-primary" type="button" onClick={() => {
          setEditingVehicle(false)
          setVehicleForm(initialVehicleForm)
          setVehicleFormOpen(true)
        }}><Plus />Register vehicle</button>}
      />
      {feedback && <p className="fleet-feedback fleet-success" role="status">{feedback}</p>}
      {actionError && <p className="fleet-feedback fleet-error" role="alert">{actionError}</p>}
      {vehicleFormOpen && <form className="panel fleet-form" onSubmit={(event) => void submitVehicle(event)}>
        <div className="panel-heading"><h2>{editingVehicle ? 'Edit vehicle' : 'Register a vehicle'}</h2><button className="text-button" type="button" onClick={() => setVehicleFormOpen(false)}>Cancel</button></div>
        <div className="form-grid">
          <label className="field">Registration number<input required maxLength={32} value={vehicleForm.registrationNumber} onChange={(event) => setVehicleForm({ ...vehicleForm, registrationNumber: event.target.value })} /></label>
          <label className="field">Vehicle type<input required maxLength={60} value={vehicleForm.vehicleType} onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })} /></label>
          <label className="field">Make<input required maxLength={80} value={vehicleForm.make} onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.target.value })} /></label>
          <label className="field">Model<input required maxLength={80} value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })} /></label>
          <label className="field">Year<input type="number" required min="1886" max={new Date().getFullYear() + 1} value={vehicleForm.modelYear} onChange={(event) => setVehicleForm({ ...vehicleForm, modelYear: Number(event.target.value) })} /></label>
          <label className="field">Seating capacity<input type="number" required min="1" max="200" value={vehicleForm.seatingCapacity} onChange={(event) => setVehicleForm({ ...vehicleForm, seatingCapacity: Number(event.target.value) })} /></label>
          <label className="field">Status<select value={vehicleForm.status} onChange={(event) => setVehicleForm({ ...vehicleForm, status: event.target.value as VehicleStatus })}>
            <option value="active">Active</option><option value="maintenance">Maintenance</option><option value="suspended">Suspended</option><option value="retired">Retired</option>
          </select></label>
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editingVehicle ? 'Save changes' : 'Register vehicle'}</button>
      </form>}

      <div className="fleet-layout">
        <section className="panel fleet-list-panel" aria-label="Vehicle list">
          <div className="panel-heading"><h2>Vehicles</h2><button className="icon-button" type="button" aria-label="Refresh fleet data" onClick={() => void refreshAll()}><Clock3 /></button></div>
          <div className="fleet-filters">
            <label className="search-field"><Search /><input aria-label="Search vehicles" placeholder="Search registration, make, or model" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <label className="field">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | VehicleStatus)}>
              <option value="all">All statuses</option><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="suspended">Suspended</option><option value="retired">Retired</option>
            </select></label>
          </div>
          {loading ? <p className="muted" role="status">Loading vehicles…</p>
            : listError ? <div className="fleet-error-state"><AlertTriangle /><strong>{isFleetSchemaUnavailable(new Error(listError)) ? 'Fleet database migration is not connected' : 'Vehicles could not be loaded'}</strong><p>{listError}</p><button className="button button-secondary" type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button></div>
              : filteredVehicles.length === 0 ? <div className="fleet-empty"><Bus /><h3>{vehicles.length ? 'No matching vehicles' : 'No vehicles registered'}</h3><p>{vehicles.length ? 'Try another search or status filter.' : 'Register a vehicle to begin fleet administration.'}</p></div>
                : <div className="fleet-vehicle-list">{filteredVehicles.map((vehicle) => <button
                  type="button"
                  className={`fleet-vehicle-option${selectedId === vehicle.id ? ' selected' : ''}`}
                  key={vehicle.id}
                  onClick={() => {
                    setDetailsLoading(true)
                    setDetailsError('')
                    setSelectedId(vehicle.id)
                  }}
                >
                  <span className="stat-icon"><Bus /></span><span><strong>{vehicle.registration_number}</strong><small>{vehicle.make} {vehicle.model} · {vehicle.seating_capacity} seats</small></span><span className={`status-pill status-${vehicle.status}`}>{vehicle.status}</span>
                </button>)}</div>}
        </section>

        <section className="fleet-detail">
          {!selectedVehicle ? <div className="panel"><div className="fleet-empty"><Bus /><h3>Select a vehicle</h3><p>Vehicle registration, compliance, assignment history, and maintenance details appear here.</p></div></div>
            : <>
              <section className="panel">
                <div className="panel-heading fleet-detail-heading">
                  <div><p className="eyebrow">VEHICLE RECORD</p><h2>{selectedVehicle.registration_number}</h2><p className="muted">{selectedVehicle.make} {selectedVehicle.model} · {selectedVehicle.model_year} · {selectedVehicle.seating_capacity} seats</p></div>
                  <span className={`status-pill status-${selectedVehicle.status}`}>{selectedVehicle.status}</span>
                </div>
                <div className="fleet-vehicle-meta"><span>Type <strong>{selectedVehicle.vehicle_type}</strong></span><span>Updated <strong>{new Date(selectedVehicle.updated_at).toLocaleDateString()}</strong></span></div>
                <button className="button button-secondary" type="button" onClick={() => {
                  setVehicleForm({
                    registrationNumber: selectedVehicle.registration_number,
                    vehicleType: selectedVehicle.vehicle_type,
                    make: selectedVehicle.make,
                    model: selectedVehicle.model,
                    modelYear: selectedVehicle.model_year,
                    seatingCapacity: selectedVehicle.seating_capacity,
                    status: selectedVehicle.status,
                  })
                  setEditingVehicle(true)
                  setVehicleFormOpen(true)
                }}>Edit vehicle</button>
              </section>

              {detailsError && <p className="fleet-feedback fleet-error" role="alert">{detailsError}</p>}
              <section className="panel">
                <div className="panel-heading"><div><h2>Compliance documents</h2><p className="muted">Private files are accessible only to authorized fleet managers.</p></div><ShieldCheck /></div>
                {detailsLoading ? <p className="muted" role="status">Loading document status…</p>
                  : <div className="fleet-document-list">{(['registration', 'insurance', 'roadworthiness'] as const).map((type) => {
                    const document = latestDocuments.get(type)
                    return <article className="fleet-document-item" key={type}>
                      <span className="stat-icon"><FileCheck2 /></span>
                      <div><strong>{type === 'roadworthiness' ? 'Roadworthiness' : type[0].toUpperCase() + type.slice(1)}</strong>
                        <small>{document ? `${document.file_name} · ${document.expiry_date ? `Expires ${displayDate(document.expiry_date)}` : 'No expiry date'}` : 'No document uploaded'}</small>
                      </div>
                      <span className={`status-pill status-${document ? documentStatus(document) : 'missing'}`}>{document ? documentStatus(document).replace('-', ' ') : 'missing'}</span>
                      {document && <div className="fleet-document-actions">
                        {signedLinks[document.id]
                          ? <a className="button button-secondary" href={signedLinks[document.id]} target="_blank" rel="noreferrer">Open secure file</a>
                          : <button className="button button-secondary" type="button" disabled={busy} onClick={() => void fleetService.createDocumentUrl(document.object_path).then((url) => setSignedLinks((current) => ({ ...current, [document.id]: url }))).catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Secure document link could not be created.'))}>Create secure link</button>}
                        {document.review_status === 'pending' && <div className="button-row compact">
                          <button className="button button-primary" type="button" disabled={busy} onClick={() => void runAction(() => fleetService.reviewDocument(document.id, true), 'Vehicle document approved.')}>Approve</button>
                          <button className="button button-danger" type="button" disabled={busy} onClick={() => void runAction(() => fleetService.reviewDocument(document.id, false), 'Vehicle document rejected.')}>Reject</button>
                        </div>}
                      </div>}
                    </article>
                  })}</div>}
                <form className="fleet-inline-form" onSubmit={(event) => void submitDocument(event)}>
                  <label className="field">Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value as VehicleDocumentType)}>
                    <option value="registration">Registration</option><option value="insurance">Insurance</option><option value="roadworthiness">Roadworthiness</option>
                  </select></label>
                  <label className="field">File (PDF, JPG, PNG, WebP · max 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} /></label>
                  <label className="field">Expiry date{documentType !== 'registration' && <span aria-hidden="true"> *</span>}<input type="date" min={localDate()} required={documentType !== 'registration'} value={documentExpiry} onChange={(event) => setDocumentExpiry(event.target.value)} /></label>
                  <button className="button button-primary" type="submit" disabled={busy || !documentFile}>{busy ? 'Uploading…' : 'Upload privately'}</button>
                </form>
                {!requiredDocumentsCurrent && <p className="fleet-warning"><AlertTriangle />Assignment requires approved registration, insurance, and roadworthiness documents. Insurance and roadworthiness must be unexpired.</p>}
              </section>

              <section className="panel">
                <div className="panel-heading"><div><h2>Driver assignment</h2><p className="muted">Only active, approved driver accounts can be assigned.</p></div><Bus /></div>
                {driverError && <p className="fleet-feedback fleet-error" role="alert">{driverError}</p>}
                <div className="fleet-inline-form fleet-assignment-form">
                  <label className="field">Assigned driver<select value={assignmentDriverId} onChange={(event) => setAssignmentDriverId(event.target.value)} disabled={selectedVehicle.status !== 'active'}>
                    <option value="">Unassigned</option>{drivers.map((driver) => <option value={driver.driver_user_id} key={driver.driver_user_id}>{driver.full_name}</option>)}
                  </select></label>
                  <button className="button button-primary" type="button" disabled={busy || (assignmentDriverId !== '' && (selectedVehicle.status !== 'active' || !requiredDocumentsCurrent))} onClick={() => void runAction(() => fleetService.assignDriver(selectedVehicle.id, assignmentDriverId || null), assignmentDriverId ? 'Driver assignment saved.' : 'Vehicle assignment ended.')}>{busy ? 'Saving…' : assignmentDriverId ? 'Save assignment' : 'End assignment'}</button>
                </div>
                {selectedVehicle.status !== 'active' && <p className="fleet-warning"><AlertTriangle />This vehicle is {selectedVehicle.status} and cannot receive a driver assignment.</p>}
                <div className="fleet-history">
                  <h3>Assignment history</h3>
                  {assignments.length === 0 ? <p className="muted">No driver assignments recorded.</p>
                    : assignments.map((assignment) => <article key={assignment.id}><div><strong>{assignment.driver_name}</strong><small>{new Date(assignment.started_at).toLocaleString()} – {assignment.ended_at ? new Date(assignment.ended_at).toLocaleString() : 'Current'}</small></div><span className="status-pill">{assignment.ended_at ? 'Ended' : 'Active'}</span></article>)}
                </div>
                {activeAssignment && <p className="fleet-feedback">Currently assigned to {activeAssignment.driver_name}.</p>}
              </section>

              <section className="panel">
                <div className="panel-heading"><div><h2>Maintenance</h2><p className="muted">Service history and upcoming due dates.</p></div><Wrench /></div>
                <form className="fleet-inline-form" onSubmit={(event) => void submitMaintenance(event)}>
                  <label className="field">Service type<input required maxLength={100} value={maintenanceForm.serviceType} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, serviceType: event.target.value })} placeholder="e.g. Routine service" /></label>
                  <label className="field">Service date<input type="date" required value={maintenanceForm.maintenanceDate} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, maintenanceDate: event.target.value })} /></label>
                  <label className="field">Next due date<input type="date" min={maintenanceForm.maintenanceDate} value={maintenanceForm.nextDueDate} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, nextDueDate: event.target.value })} /></label>
                  <label className="field">Status<select value={maintenanceForm.status} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, status: event.target.value as MaintenanceStatus })}>
                    <option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                  </select></label>
                  <label className="field fleet-notes-field">Notes<textarea rows={2} maxLength={5000} value={maintenanceForm.notes} onChange={(event) => setMaintenanceForm({ ...maintenanceForm, notes: event.target.value })} /></label>
                  <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add maintenance record'}</button>
                </form>
                <div className="fleet-history">
                  <h3>Service history</h3>
                  {detailsLoading ? <p className="muted" role="status">Loading maintenance records…</p>
                    : maintenance.length === 0 ? <p className="muted">No maintenance records.</p>
                      : maintenance.map((record) => <MaintenanceItem key={record.id} record={record} busy={busy} onUpdate={(status, nextDueDate) => void runAction(() => fleetService.updateMaintenanceRecord(record.id, status, nextDueDate), `Maintenance record marked ${status.replace('_', ' ')}.`)} />)}
                </div>
              </section>
            </>}
        </section>
      </div>
    </>
  )
}

function MaintenanceItem({ record, busy, onUpdate }: {
  record: VehicleMaintenanceRecord
  busy: boolean
  onUpdate: (status: MaintenanceStatus, nextDueDate: string | null) => void
}) {
  const overdue = record.next_due_date !== null
    && record.next_due_date < localDate()
    && record.status !== 'completed'
    && record.status !== 'cancelled'
  return <article className="fleet-maintenance-item">
    <div><strong>{record.service_type}</strong><small>{displayDate(record.maintenance_date)}{record.next_due_date ? ` · Due ${displayDate(record.next_due_date)}` : ''}</small>{record.notes && <p>{record.notes}</p>}</div>
    <span className={`status-pill status-${overdue ? 'expired' : record.status}`}>{overdue ? 'Overdue' : record.status.replace('_', ' ')}</span>
    {record.status !== 'completed' && record.status !== 'cancelled' && <div className="button-row compact">
      {record.status === 'scheduled' && <button className="button button-secondary" type="button" disabled={busy} onClick={() => onUpdate('in_progress', record.next_due_date)}>Start</button>}
      <button className="button button-primary" type="button" disabled={busy} onClick={() => onUpdate('completed', record.next_due_date)}>Complete</button>
    </div>}
  </article>
}

export function DriverAssignedVehicle() {
  const [documents, setDocuments] = useState<AssignedVehicleDocumentStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void fleetService.getMyAssignedVehicleSummary().then((result) => {
      if (active) setDocuments(result)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Assigned vehicle information is unavailable.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const vehicle = documents[0]
  return <section className="panel driver-fleet-panel">
    <div className="panel-heading"><div><h2>Assigned vehicle</h2><p className="muted">Vehicle and minimum compliance status</p></div><Bus /></div>
    {loading ? <p className="muted" role="status">Loading assigned vehicle…</p>
      : error ? <p className="fleet-feedback fleet-error" role="alert">{error}</p>
        : !vehicle ? <p className="muted">No vehicle is currently assigned to your driver account.</p>
          : <>
            <div className="profile-details">
              <div><small>REGISTRATION</small><strong>{vehicle.registration_number}</strong></div>
              <div><small>VEHICLE</small><strong>{vehicle.make} {vehicle.model} · {vehicle.model_year}</strong></div>
              <div><small>CAPACITY</small><strong>{vehicle.seating_capacity} seats · {vehicle.vehicle_type}</strong></div>
              <div><small>STATUS</small><strong>{vehicle.vehicle_status}</strong></div>
            </div>
            <div className="fleet-driver-documents">{documents.map((document) => <p key={document.document_type}>
              {document.document_status === 'approved' ? <CheckCircle2 /> : <AlertTriangle />}
              <span>{document.document_type[0].toUpperCase() + document.document_type.slice(1)}</span>
              <strong>{document.document_status.replace('_', ' ')}{document.expiry_date ? ` · ${displayDate(document.expiry_date)}` : ''}</strong>
            </p>)}</div>
          </>}
  </section>
}
