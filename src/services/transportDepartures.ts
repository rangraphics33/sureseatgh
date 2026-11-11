import { getSupabaseClient } from './supabaseClient.ts'

export interface TransportDeparture {
  id: string
  route_id: string
  travel_date: string
  departure_time: string
  driver_user_id: string
  vehicle_id: string
  status: 'scheduled' | 'boarding' | 'in_progress' | 'completed' | 'cancelled'
  capacity: number
}

export interface DepartureAssignment {
  vehicle_id: string
  registration_number: string
  seating_capacity: number
  driver_user_id: string
  driver_name: string
}

function throwOnError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

export const transportDepartureService = {
  async listUpcoming(): Promise<TransportDeparture[]> {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const { data, error } = await getSupabaseClient()
      .from('transport_departures')
      .select('id,route_id,travel_date,departure_time,driver_user_id,vehicle_id,status,capacity')
      .gte('travel_date', today)
      .in('status', ['scheduled', 'boarding', 'in_progress'])
      .order('travel_date')
      .order('departure_time')
    throwOnError(error, 'Could not load scheduled departures')
    return (data ?? []) as TransportDeparture[]
  },

  async listEligibleAssignments(): Promise<DepartureAssignment[]> {
    const { data, error } = await getSupabaseClient().rpc('list_transport_departure_assignments')
    throwOnError(error, 'Could not load eligible vehicle and driver assignments')
    return (data ?? []) as DepartureAssignment[]
  },

  async save(input: {
    departureId?: string
    routeId: string
    travelDate: string
    departureTime: string
    driverUserId: string
    vehicleId: string
  }): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc('admin_save_transport_departure', {
      p_departure_id: input.departureId ?? null,
      p_route_id: input.routeId,
      p_travel_date: input.travelDate,
      p_departure_time: input.departureTime,
      p_driver_user_id: input.driverUserId,
      p_vehicle_id: input.vehicleId,
    })
    throwOnError(error, 'Could not save departure')
    if (typeof data !== 'string') throw new Error('Could not save departure: the database returned no ID.')
    return data
  },
}
