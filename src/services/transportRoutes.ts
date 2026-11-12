import type { Route } from '../data/routes.ts'
import { initialRoutes } from '../data/routes.ts'
import { getSupabaseClient } from './supabaseClient.ts'

type RouteRow = {
  id: string
  name: string
  via: string
  status: 'draft' | 'published' | 'archived'
  full_route_fare: number | string
}

type StopRow = { route_id: string; stop_index: number; stop_name: string }
export type SaveTransportRouteInput = Pick<Route, 'name' | 'via' | 'stops' | 'standardFare'> & {
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
  const [stopsResult] = await Promise.all([
    client.from('transport_route_stops').select('route_id,stop_index,stop_name').in('route_id', ids).order('stop_index'),
  ])
  throwIfError(stopsResult.error)

  const stopsByRoute = new Map<string, StopRow[]>()
  for (const stop of (stopsResult.data ?? []) as StopRow[]) {
    const list = stopsByRoute.get(stop.route_id) ?? []
    list.push(stop)
    stopsByRoute.set(stop.route_id, list)
  }
  return rows.map((row) => {
    const stops = stopsByRoute.get(row.id) ?? []
    const storedFare = Number(row.full_route_fare)
    return {
      id: row.id,
      name: row.name,
      via: row.via,
      stops: stops.map((stop) => stop.stop_name),
      standardFare: storedFare > 0 ? storedFare : null,
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
    p_full_route_fare: input.standardFare ?? 0,
    p_stops: input.stops,
    // Kept for the current RPC signature; the standard-fare migration ignores it.
    p_segment_fares: Array.from({ length: Math.max(0, input.stops.length - 1) }, () => null),
    p_publish: input.publish,
  })
  throwIfError(error)
  if (typeof data !== 'string') throw new Error('Route save returned an invalid route identifier.')
  return data
}

export async function ensureStarterTransportRoutes(): Promise<{ routes: Route[]; addedCount: number }> {
  const currentRoutes = await getTransportRoutes()
  let addedCount = 0

  for (const starter of initialRoutes) {
    const existing = currentRoutes.find((route) => (
      route.name.trim().toLowerCase() === starter.name.trim().toLowerCase()
      && route.via.trim().toLowerCase() === starter.via.trim().toLowerCase()
    ))
    if (existing?.stops.length) continue

    await saveTransportRoute({
      ...(existing ? { id: existing.id } : {}),
      name: starter.name,
      via: starter.via,
      stops: [...starter.stops],
      // Preview prices are never copied into Supabase. An administrator enters
      // the approved standard fare before publishing.
      standardFare: existing?.standardFare ?? null,
      publish: false,
    })
    addedCount += 1
  }

  return { routes: await getTransportRoutes(), addedCount }
}
