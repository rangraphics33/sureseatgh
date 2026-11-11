import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, Plus, RotateCcw } from 'lucide-react'
import type { Route } from '../../data/routes.ts'
import { getTransportRoutes } from '../../services/transportRoutes.ts'
import { transportDepartureService } from '../../services/transportDepartures.ts'
import type { DepartureAssignment, TransportDeparture } from '../../services/transportDepartures.ts'

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const emptyForm = { routeId: '', travelDate: localDate(), departureTime: '', assignmentId: '' }

export default function ScheduledDepartureManagement() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [departures, setDepartures] = useState<TransportDeparture[]>([])
  const [assignments, setAssignments] = useState<DepartureAssignment[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [loadedRoutes, loadedDepartures, loadedAssignments] = await Promise.all([
        getTransportRoutes(),
        transportDepartureService.listUpcoming(),
        transportDepartureService.listEligibleAssignments(),
      ])
      setRoutes(loadedRoutes)
      setDepartures(loadedDepartures)
      setAssignments(loadedAssignments)
      setForm((current) => ({
        ...current,
        routeId: current.routeId || loadedRoutes.find((route) => route.published)?.id || '',
        assignmentId: current.assignmentId || (loadedAssignments[0]
          ? `${loadedAssignments[0].driver_user_id}|${loadedAssignments[0].vehicle_id}`
          : ''),
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Scheduled departures could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const publishedRoutes = useMemo(() => routes.filter((route) => route.published), [routes])
  const selectedAssignment = assignments.find((assignment) =>
    `${assignment.driver_user_id}|${assignment.vehicle_id}` === form.assignmentId)

  function editDeparture(departure: TransportDeparture) {
    setEditingId(departure.id)
    setForm({
      routeId: departure.route_id,
      travelDate: departure.travel_date,
      departureTime: departure.departure_time.slice(0, 5),
      assignmentId: `${departure.driver_user_id}|${departure.vehicle_id}`,
    })
    setNotice('Editing is available only before bookings have been made.')
  }

  function clearForm() {
    setEditingId('')
    setForm({
      ...emptyForm,
      routeId: publishedRoutes[0]?.id ?? '',
      assignmentId: assignments[0]
        ? `${assignments[0].driver_user_id}|${assignments[0].vehicle_id}`
        : '',
    })
    setNotice('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedAssignment) {
      setError('Choose a currently eligible assigned vehicle and driver.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await transportDepartureService.save({
        departureId: editingId || undefined,
        routeId: form.routeId,
        travelDate: form.travelDate,
        departureTime: form.departureTime,
        driverUserId: selectedAssignment.driver_user_id,
        vehicleId: selectedAssignment.vehicle_id,
      })
      clearForm()
      setNotice(editingId ? 'Scheduled departure updated.' : 'Departure scheduled.')
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Departure could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const routeName = (routeId: string) => {
    const route = routes.find((item) => item.id === routeId)
    return route ? `${route.name} via ${route.via}` : 'Route unavailable'
  }
  const assignmentName = (departure: TransportDeparture) => {
    const assignment = assignments.find((item) => item.driver_user_id === departure.driver_user_id
      && item.vehicle_id === departure.vehicle_id)
    return assignment ? `${assignment.driver_name} · ${assignment.registration_number}` : 'Assignment no longer eligible'
  }

  return <>
      <div className="page-title">
      <div><p className="eyebrow">ADMIN · OPERATIONS</p><h1>Scheduled departures</h1><p className="muted">Assign published routes to currently eligible drivers and vehicles.</p></div>
      <button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RotateCcw size={16} />Refresh</button>
    </div>
    {error && <p className="fleet-feedback fleet-error" role="alert">{error}</p>}
    {notice && <p className="fleet-feedback fleet-success" role="status">{notice}</p>}
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-heading"><h2>{editingId ? 'Edit scheduled departure' : 'Schedule a departure'}</h2>{editingId && <button type="button" className="button button-secondary" onClick={clearForm}>Cancel edit</button>}</div>
      <div className="form-grid">
        <label className="field">Published route
          <select required value={form.routeId} onChange={(event) => setForm({ ...form, routeId: event.target.value })}>
            <option value="">Select route</option>{publishedRoutes.map((route) => <option value={route.id} key={route.id}>{route.name} · {route.via}</option>)}
          </select>
        </label>
        <label className="field">Travel date<input type="date" min={localDate()} required value={form.travelDate} onChange={(event) => setForm({ ...form, travelDate: event.target.value })} /></label>
        <label className="field">Departure time<input type="time" required value={form.departureTime} onChange={(event) => setForm({ ...form, departureTime: event.target.value })} /></label>
        <label className="field">Eligible driver and vehicle
          <select required value={form.assignmentId} onChange={(event) => setForm({ ...form, assignmentId: event.target.value })}>
            <option value="">Select eligible assignment</option>{assignments.map((assignment) => <option value={`${assignment.driver_user_id}|${assignment.vehicle_id}`} key={`${assignment.driver_user_id}|${assignment.vehicle_id}`}>{assignment.driver_name} · {assignment.registration_number} · {assignment.seating_capacity} seats</option>)}
          </select>
        </label>
      </div>
      {selectedAssignment && <p className="muted">Passenger capacity is set from the vehicle record: {selectedAssignment.seating_capacity} seats.</p>}
      {!loading && !publishedRoutes.length && <p className="muted">Publish a route before scheduling departures.</p>}
      {!loading && !assignments.length && <p className="muted">No eligible assigned vehicle and driver pair is available. Check driver approval, vehicle status, assignment, and required vehicle documents.</p>}
      <button className="button button-primary" disabled={saving || loading || !publishedRoutes.length || !assignments.length}><Plus size={16} />{saving ? 'Saving…' : editingId ? 'Save departure' : 'Schedule departure'}</button>
    </form>
    <div className="panel">
      <div className="panel-heading"><h2>Upcoming departures</h2><span className="status-pill">{departures.length}</span></div>
      {loading ? <p className="muted" role="status">Loading departures…</p> : departures.length ? <div className="table-scroll"><table><thead><tr><th>Date & time</th><th>Route</th><th>Driver & vehicle</th><th>Capacity</th><th>Status</th><th>Action</th></tr></thead><tbody>{departures.map((departure) => <tr key={departure.id}><td>{departure.travel_date} · {departure.departure_time.slice(0, 5)}</td><td>{routeName(departure.route_id)}</td><td>{assignmentName(departure)}</td><td>{departure.capacity} seats</td><td>{departure.status}</td><td>{departure.status === 'scheduled' && <button className="button button-secondary" type="button" onClick={() => editDeparture(departure)}>Edit</button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><CalendarDays /><h3>No upcoming departures</h3><p>Schedule the first departure above after routes and eligible fleet assignments are ready.</p></div>}
    </div>
  </>
}
