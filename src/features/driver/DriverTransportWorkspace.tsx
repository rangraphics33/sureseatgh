import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bus, CalendarDays, Check, CheckCircle2, FileCheck2, Navigation, RotateCcw, Ticket, UserRound } from 'lucide-react'
import { SectionSkeleton } from '../../components/Skeleton'
import { transportDriverService } from '../../services/transportDriver.ts'
import type { DriverDeparture, DriverManifestEntry } from '../../services/transportDriver.ts'

export type DriverSection = 'Overview' | 'Assigned Trips' | 'Passenger Manifest' | 'Active Trip'

function formatDateTime(date: string, time: string) {
  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime())
    ? `${date} · ${time.slice(0, 5)}`
    : value.toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function DriverTransportWorkspace({ section, onNavigate }: {
  section: DriverSection
  onNavigate: (section: string) => void
}) {
  const [departures, setDepartures] = useState<DriverDeparture[]>([])
  const [selectedDepartureId, setSelectedDepartureId] = useState('')
  const [manifest, setManifest] = useState<DriverManifestEntry[]>([])
  const [bookingCode, setBookingCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await transportDriverService.listMyDepartures()
      setDepartures(rows)
      setSelectedDepartureId((current) => rows.some((row) => row.id === current)
        ? current
        : rows.find((row) => row.status === 'in_progress')?.id
          ?? rows.find((row) => row.status === 'boarding')?.id
          ?? rows.find((row) => row.status === 'scheduled')?.id
          ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Assigned departures could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadManifest = useCallback(async (departureId: string) => {
    if (!departureId) {
      setManifest([])
      return
    }
    setManifestLoading(true)
    try {
      const rows = await transportDriverService.listManifest(departureId)
      setManifest(rows)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Passenger manifest could not be loaded.')
    } finally {
      setManifestLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadManifest(selectedDepartureId) }, 0)
    return () => window.clearTimeout(timer)
  }, [loadManifest, selectedDepartureId])

  const selectedDeparture = departures.find((departure) => departure.id === selectedDepartureId)
  const activeDepartures = useMemo(
    () => departures.filter((departure) => departure.status === 'scheduled'
      || departure.status === 'boarding' || departure.status === 'in_progress'),
    [departures],
  )
  const nextDeparture = activeDepartures[0]
  const totalCompletionRequests = departures.reduce((total, departure) => total + departure.completionRequests, 0)

  async function runAction(action: () => Promise<void>, success: string) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
      await refresh()
      if (selectedDepartureId) await loadManifest(selectedDepartureId)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The trip action could not be completed.')
    } finally {
      setSaving(false)
    }
  }

  async function verifyCode() {
    if (!selectedDeparture || !bookingCode.trim()) return
    await runAction(async () => {
      await transportDriverService.verifyPassengerCode(bookingCode)
      setBookingCode('')
    }, 'Passenger booking verified and marked as boarded.')
  }

  async function openBoarding(departure: DriverDeparture) {
    setSelectedDepartureId(departure.id)
    await runAction(() => transportDriverService.openBoarding(departure.id), 'Boarding is open for this departure.')
  }

  async function startDeparture(departure: DriverDeparture) {
    await runAction(() => transportDriverService.startDeparture(departure.id), 'Trip started. Passenger boarding and journey updates are active.')
  }

  async function confirmCompletion(passenger: DriverManifestEntry) {
    await runAction(
      () => transportDriverService.confirmPassengerCompletion(passenger.bookingId),
      `Journey completion confirmed for ${passenger.passengerName}.`,
    )
  }

  function departureCard(departure: DriverDeparture) {
    return <article className="panel assigned-trip" key={departure.id}>
      <div className="section-heading"><div><h2>{departure.routeName} via {departure.routeVia}</h2><p className="muted">{formatDateTime(departure.travelDate, departure.departureTime)}</p></div><span className={`status-pill ${departure.status === 'in_progress' ? 'status-live' : ''}`}>{departure.status.replaceAll('_', ' ')}</span></div>
      <div className="trip-meta"><span>{departure.confirmedPassengers} confirmed journeys · {departure.boardedPassengers} boarded</span><span>{departure.vehicleType} · {departure.vehicleRegistration}</span><span>Vehicle capacity: {departure.capacity}</span></div>
      {departure.status === 'scheduled' && <button className="button button-primary" type="button" disabled={saving} onClick={() => void openBoarding(departure)}>Open boarding <ArrowRight size={16} /></button>}
      {departure.status === 'boarding' && <div className="button-row"><button className="button button-secondary" type="button" onClick={() => { setSelectedDepartureId(departure.id); onNavigate('Passenger Manifest') }}>View passenger manifest <FileCheck2 size={16} /></button><button className="button button-primary" type="button" disabled={saving} onClick={() => { setSelectedDepartureId(departure.id); onNavigate('Active Trip') }}>Prepare departure <ArrowRight size={16} /></button></div>}
      {departure.status === 'in_progress' && <button className="button button-primary" type="button" onClick={() => { setSelectedDepartureId(departure.id); onNavigate('Active Trip') }}>Open active trip <Navigation size={16} /></button>}
    </article>
  }

  return <>
    <div className="page-title">
      <div><p className="eyebrow">DRIVER · OPERATIONS</p><h1>{section === 'Overview' ? 'Driver workspace' : section}</h1><p className="muted">Assigned departures, passenger boarding, and journey completion.</p></div>
      <button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RotateCcw size={16} />Refresh</button>
    </div>
    {error && <p className="fleet-feedback fleet-error" role="alert">{error}</p>}
    {notice && <p className="fleet-feedback fleet-success" role="status">{notice}</p>}
    {loading ? <SectionSkeleton variant={section === 'Overview' ? 'table' : 'trips'} /> : <>
      {section === 'Overview' && <>
        <div className="stats-grid">
          <div className="panel stat-card"><div className="stat-top"><span>Upcoming trips</span><span className="stat-icon"><Bus /></span></div><strong>{activeDepartures.length}</strong><small>Assigned to your account</small></div>
          <div className="panel stat-card"><div className="stat-top"><span>Passengers boarded</span><span className="stat-icon"><UserRound /></span></div><strong>{departures.reduce((count, departure) => count + departure.boardedPassengers, 0)}</strong><small>Across listed departures</small></div>
          <div className="panel stat-card"><div className="stat-top"><span>Completion requests</span><span className="stat-icon"><CheckCircle2 /></span></div><strong>{totalCompletionRequests}</strong><small>Awaiting driver confirmation</small></div>
        </div>
        {nextDeparture ? <div className="panel panel-action"><div><h2>Next departure</h2><p className="muted">{nextDeparture.routeName} via {nextDeparture.routeVia} · {formatDateTime(nextDeparture.travelDate, nextDeparture.departureTime)}</p><span className="preview-note">{nextDeparture.confirmedPassengers} confirmed journeys · {nextDeparture.capacity} vehicle seats</span></div><button className="button button-primary" onClick={() => onNavigate(nextDeparture.status === 'in_progress' ? 'Active Trip' : 'Assigned Trips')}>Open trip <ArrowRight size={16} /></button></div> : <div className="panel"><p className="muted">No upcoming departure is assigned to you.</p></div>}
        <button className="button button-secondary" type="button" onClick={() => onNavigate('Assigned Trips')}>View assigned trips</button>
      </>}

      {section === 'Assigned Trips' && <>
        <div className="card-list">{activeDepartures.map(departureCard)}</div>
        {!activeDepartures.length && <div className="empty-state"><CalendarDays /><h3>No upcoming departures</h3><p>Your assigned departures will appear here when an administrator schedules them.</p></div>}
      </>}

      {(section === 'Passenger Manifest' || section === 'Active Trip') && <>
        <div className="panel">
          <label className="field">Assigned departure
            <select value={selectedDepartureId} onChange={(event) => setSelectedDepartureId(event.target.value)}>
              <option value="">Select a departure</option>
              {departures.map((departure) => <option key={departure.id} value={departure.id}>{departure.routeName} · {formatDateTime(departure.travelDate, departure.departureTime)} · {departure.status.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          {selectedDeparture && <div className="panel-heading"><div><h2>{selectedDeparture.routeName} via {selectedDeparture.routeVia}</h2><p className="muted">{selectedDeparture.vehicleType} · {selectedDeparture.vehicleRegistration} · {formatDateTime(selectedDeparture.travelDate, selectedDeparture.departureTime)}</p></div><span className="status-pill">{selectedDeparture.status.replaceAll('_', ' ')}</span></div>}
          {selectedDeparture?.status === 'scheduled' && <button className="button button-primary" type="button" disabled={saving} onClick={() => void openBoarding(selectedDeparture)}>Open boarding</button>}
          {selectedDeparture?.status === 'boarding' && <div className="button-row"><button className="button button-primary" type="button" disabled={saving} onClick={() => void startDeparture(selectedDeparture)}><Navigation size={16} />Start trip</button><span className="muted">Board confirmed passengers by checking their booking codes below.</span></div>}
          {!selectedDeparture && <p className="muted">Select one of your assigned departures to view its passengers and trip actions.</p>}
        </div>

        {selectedDeparture && (selectedDeparture.status === 'boarding' || selectedDeparture.status === 'in_progress') && <form className="panel inline-form" onSubmit={(event) => { event.preventDefault(); void verifyCode() }}>
          <label className="field">Passenger booking code<input autoComplete="off" value={bookingCode} onChange={(event) => setBookingCode(event.target.value.toUpperCase())} placeholder="Enter the code shown by the passenger" required /></label>
          <button className="button button-primary" type="submit" disabled={saving || !bookingCode.trim()}><Check size={16} />{saving ? 'Verifying…' : 'Verify and board'}</button>
        </form>}

        {selectedDeparture && <div className="panel">
          <div className="panel-heading"><h2>Passenger manifest</h2><span className="status-pill">{manifest.length}</span></div>
          {manifestLoading ? <p className="muted" role="status">Loading passenger manifest…</p> : manifest.length ? <div className="table-scroll"><table><thead><tr><th>Passenger</th><th>Pickup</th><th>Drop-off</th><th>Journey</th>{section === 'Active Trip' && <th>Action</th>}</tr></thead><tbody>{manifest.map((passenger) => <tr key={passenger.bookingId}><td>{passenger.passengerName}</td><td>{passenger.pickupStop}</td><td>{passenger.dropoffStop}</td><td><span className="status-pill">{passenger.journeyStatus.replaceAll('_', ' ')}</span></td>{section === 'Active Trip' && <td>{passenger.journeyStatus === 'completion_requested' ? <button className="button button-secondary" type="button" disabled={saving} onClick={() => void confirmCompletion(passenger)}>Confirm passenger is off-board</button> : passenger.journeyStatus === 'completed' ? 'Completed' : passenger.journeyStatus === 'boarded' ? 'On board' : 'Waiting to board'}</td>}</tr>)}</tbody></table></div> : <div className="empty-state"><Ticket /><h3>No confirmed passengers yet</h3><p>Confirmed paid bookings will appear here, ordered by pickup stop.</p></div>}
          <p className="muted">Board only passengers who present a valid booking code. Confirm a completion request after the passenger has left the vehicle.</p>
        </div>}
      </>}
    </>}
  </>
}
