import type { PreviewRide } from '../data/previewData.ts'
import type { BookingRecord, CreateBookingRequest, PaginatedResult, RideSearchRequest } from './platform.ts'
import { getSupabaseClient } from './supabaseClient.ts'

interface DepartureSearchRow {
  departure_id: string
  departure_time: string
  vehicle: string
  driver: string
  available_seats: number
  fare: number | string
}

interface BookingRow {
  booking_id: string
  booking_code: string
  status: BookingRecord['status']
  route_id: string
  route_name: string
  pickup: string
  dropoff: string
  travel_date: string
  departure_time: string
  departure_id: string
  vehicle: string
  driver: string
  fare: number | string
  created_at: string
  hold_expires_at: string
  total_count?: number
}

function throwOnError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

function displayTime(value: string) {
  const [hourText, minuteText] = value.split(':')
  const hour = Number(hourText)
  const minute = minuteText ?? '00'
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}

function toBookingRecord(row: BookingRow): BookingRecord {
  return {
    id: row.booking_id,
    bookingCode: row.booking_code,
    status: row.status,
    routeId: row.route_id,
    routeName: row.route_name,
    pickup: row.pickup,
    dropoff: row.dropoff,
    travelDate: row.travel_date,
    departure: displayTime(row.departure_time),
    rideId: row.departure_id,
    vehicle: row.vehicle,
    driver: row.driver,
    totalFare: Number(row.fare),
    createdAt: row.created_at,
  }
}

export const transportBookingService = {
  async search(request: RideSearchRequest): Promise<PreviewRide[]> {
    const { data, error } = await getSupabaseClient().rpc('search_available_transport_departures', {
      p_route_id: request.routeId,
      p_travel_date: request.travelDate,
      p_departure_window: request.departure,
      p_pickup_stop_index: request.pickupIndex,
      p_dropoff_stop_index: request.dropoffIndex,
    })
    throwOnError(error, 'Could not search scheduled departures')
    return ((data ?? []) as DepartureSearchRow[]).map((row) => ({
      id: row.departure_id,
      vehicle: row.vehicle,
      driver: row.driver,
      departure: displayTime(row.departure_time),
      seats: row.available_seats,
      routeIds: [request.routeId],
      fare: Number(row.fare),
    }))
  },

  async createHold(request: CreateBookingRequest): Promise<BookingRecord> {
    const { data, error } = await getSupabaseClient().rpc('create_transport_booking_hold', {
      p_idempotency_key: request.idempotencyKey,
      p_departure_id: request.rideId,
      p_pickup_stop_index: request.pickupIndex,
      p_dropoff_stop_index: request.dropoffIndex,
    })
    throwOnError(error, 'Could not create booking hold')
    const row = Array.isArray(data) ? data[0] as BookingRow | undefined : data as BookingRow | null
    if (!row?.booking_id) throw new Error('Could not create booking hold: the database returned no booking.')
    return toBookingRecord(row)
  },

  async listMine(page = 1, pageSize = 20): Promise<PaginatedResult<BookingRecord>> {
    const { data, error } = await getSupabaseClient().rpc('list_my_transport_bookings', {
      p_page: page,
      p_page_size: pageSize,
    })
    throwOnError(error, 'Could not load your bookings')
    const rows = (data ?? []) as BookingRow[]
    const total = Number(rows[0]?.total_count ?? 0)
    return {
      items: rows.map(toBookingRecord),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    }
  },
}
