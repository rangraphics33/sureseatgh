import type { Route } from '../data/routes.ts'
import { getSupabaseClient } from './supabaseClient.ts'

type RouteRow = {
  id: string
  name: string
  via: string
  status: 'draft' | 'published' | 'archived'
  full_route_fare: number | string
}

type StopRow = { route_id: string; stop_index: number; stop_name: string }
type FareRow = { route_id: string; from_stop_index: number; fare: number | string }

export type SaveTransportRouteInput = Pick<Route, 'name' | 'via' | 'stops' | 'segmentFares' | 'fullRouteFare'> & {
  id?: string
  publish: boolean
}

function throwIfError(error: { message: string; code?: string } | null) {
  if (error) throw new Error(error.message)
}

export async function getTransportRoutes(): Promise<Route[]> {
  const client = getSupabaseClient()
  const { data: routeRows, error: routeError } = await client
    .from('transport_routes')
    .select('id,name,via,status,full_route_fare')
    .in('status', ['draft', 'published'])
    .order('created_at', { ascending: false })
  throwIfError(routeError)
  const rows = (routeRows ?? []) as RouteRow[]
  if (!rows.length) return []

  const ids = rows.map((row) => row.id)
  const [stopsResult, faresResult] = await Promise.all([
    client.from('transport_route_stops').select('route_id,stop_index,stop_name').in('route_id', ids).order('stop_index'),
    client.from('transport_route_segment_fares').select('route_id,from_stop_index,fare').in('route_id', ids).order('from_stop_index'),
  ])
  throwIfError(stopsResult.error)
  throwIfError(faresResult.error)

  const stopsByRoute = new Map<string, StopRow[]>()
  for (const stop of (stopsResult.data ?? []) as StopRow[]) {
    const list = stopsByRoute.get(stop.route_id) ?? []
    list.push(stop)
    stopsByRoute.set(stop.route_id, list)
  }
  const faresByRoute = new Map<string, FareRow[]>()
  for (const fare of (faresResult.data ?? []) as FareRow[]) {
    const list = faresByRoute.get(fare.route_id) ?? []
    list.push(fare)
    faresByRoute.set(fare.route_id, list)
  }

  return rows.map((row) => {
    const stops = stopsByRoute.get(row.id) ?? []
    const fares = faresByRoute.get(row.id) ?? []
    return {
      id: row.id,
      name: row.name,
      via: row.via,
      stops: stops.map((stop) => stop.stop_name),
      segmentFares: Array.from({ length: Math.max(0, stops.length - 1) }, (_, index) => {
        const fare = fares.find((item) => item.from_stop_index === index)
        return fare ? Number(fare.fare) : null
      }),
      fullRouteFare: Number(row.full_route_fare),
      published: row.status === 'published',
    }
  })
}

export async function saveTransportRoute(input: SaveTransportRouteInput): Promise<string> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('admin_save_transport_route', {
    p_route_id: input.id && !input.id.startsWith('draft-route-') ? input.id : null,
    p_name: input.name.trim(),
    p_via: input.via.trim(),
    p_full_route_fare: input.fullRouteFare ?? 0,
    p_stops: input.stops,
    p_segment_fares: input.segmentFares ?? [],
    p_publish: input.publish,
  })
  throwIfError(error)
  if (typeof data !== 'string') throw new Error('Route save returned an invalid route identifier.')
  return data
}
