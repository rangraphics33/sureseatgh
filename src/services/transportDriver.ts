import { getSupabaseClient } from './supabaseClient.ts'

export type DepartureStatus = 'scheduled' | 'boarding' | 'in_progress' | 'completed' | 'cancelled'
export type JourneyStatus = 'not_boarded' | 'boarded' | 'completion_requested' | 'completed'

export interface DriverDeparture {
  id: string
  routeId: string
  routeName: string
  routeVia: string
  travelDate: string
  departureTime: string
  status: DepartureStatus
  capacity: number
  vehicleRegistration: string
  vehicleType: string
  confirmedPassengers: number
  boardedPassengers: number
  completionRequests: number
}

export interface DriverManifestEntry {
  bookingId: string
  passengerName: string
  pickupStop: string
  dropoffStop: string
  bookingStatus: string
  journeyStatus: JourneyStatus
}

interface DepartureRow {
  departure_id: string
  route_id: string
  route_name: string
  route_via: string
  travel_date: string
  departure_time: string
  status: DepartureStatus
  capacity: number
  vehicle_registration: string
  vehicle_type: string
  confirmed_passengers: number
  boarded_passengers: number
  completion_requests: number
}

interface ManifestRow {
  booking_id: string
  passenger_name: string
  pickup_stop: string
  dropoff_stop: string
  booking_status: string
  journey_status: JourneyStatus
}

function throwOnError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

export const transportDriverService = {
  async listMyDepartures(): Promise<DriverDeparture[]> {
    const { data, error } = await getSupabaseClient().rpc('list_my_transport_departures')
    throwOnError(error, 'Could not load assigned departures')
    return ((data ?? []) as DepartureRow[]).map((row) => ({
      id: row.departure_id,
      routeId: row.route_id,
      routeName: row.route_name,
      routeVia: row.route_via,
      travelDate: row.travel_date,
      departureTime: row.departure_time,
      status: row.status,
      capacity: row.capacity,
      vehicleRegistration: row.vehicle_registration,
      vehicleType: row.vehicle_type,
      confirmedPassengers: Number(row.confirmed_passengers),
      boardedPassengers: Number(row.boarded_passengers),
      completionRequests: Number(row.completion_requests),
    }))
  },

  async listManifest(departureId: string): Promise<DriverManifestEntry[]> {
    const { data, error } = await getSupabaseClient().rpc('list_transport_departure_manifest', {
      p_departure_id: departureId,
    })
    throwOnError(error, 'Could not load the passenger manifest')
    return ((data ?? []) as ManifestRow[]).map((row) => ({
      bookingId: row.booking_id,
      passengerName: row.passenger_name,
      pickupStop: row.pickup_stop,
      dropoffStop: row.dropoff_stop,
      bookingStatus: row.booking_status,
      journeyStatus: row.journey_status,
    }))
  },

  async openBoarding(departureId: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('driver_begin_transport_boarding', {
      p_departure_id: departureId,
    })
    throwOnError(error, 'Could not open boarding')
  },

  async verifyPassengerCode(code: string): Promise<void> {
    const { data, error } = await getSupabaseClient().rpc('verify_transport_booking_code', {
      p_booking_code: code.trim().toUpperCase(),
    })
    throwOnError(error, 'Could not verify this booking code')
    if (!Array.isArray(data) || !data.length) throw new Error('No passenger was boarded. Check the booking code and try again.')
  },

  async startDeparture(departureId: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('driver_start_transport_departure', {
      p_departure_id: departureId,
    })
    throwOnError(error, 'Could not start this trip')
  },

  async confirmPassengerCompletion(bookingId: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('confirm_passenger_journey_completion', {
      p_booking_id: bookingId,
    })
    throwOnError(error, 'Could not confirm journey completion')
  },
}
