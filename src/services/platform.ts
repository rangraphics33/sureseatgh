import type { Route } from '../data/routes.ts'
import { initialRoutes } from '../data/routes.ts'
import { initialDriverTrips, previewRides } from '../data/previewData.ts'
import type { DriverTrip, PreviewRide } from '../data/previewData.ts'
import { getJourneyFare } from '../utils/pricing.ts'
import { matchesDepartureWindow } from '../utils/departure.ts'
import { ApiClient, ApiError } from './apiClient.ts'
import type { PaymentStatus } from '../utils/pricing.ts'

export interface PreviewPaymentRequest {
  idempotencyKey: string
  amount: number
  outcome: PaymentStatus
}

export interface PreviewPaymentResult {
  paymentId: string
  amount: number
  status: PaymentStatus
}

export interface RideSearchRequest {
  routeId: string
  travelDate: string
  departure: 'Morning' | 'Evening'
  pickupIndex: number
  dropoffIndex: number
}

export interface CreateBookingRequest extends RideSearchRequest {
  rideId: string
  idempotencyKey: string
}

export interface BookingRecord {
  id: string
  bookingCode: string
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'completed' | 'expired'
  routeId: string
  routeName: string
  pickup: string
  dropoff: string
  travelDate: string
  departure: string
  rideId: string
  vehicle: string
  driver: string
  totalFare: number
  journeyStatus?: 'not_boarded' | 'boarded' | 'completion_requested' | 'completed'
  createdAt: string
}

export interface PaginatedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

export interface PlatformService {
  getRoutes(): Promise<Route[]>
  getRides(request: RideSearchRequest): Promise<PreviewRide[]>
  getDriverTrips(): Promise<DriverTrip[]>
  simulatePayment(request: PreviewPaymentRequest): Promise<PreviewPaymentResult>
  createBooking(request: CreateBookingRequest): Promise<BookingRecord>
  getBookings(page?: number, pageSize?: number): Promise<PaginatedResult<BookingRecord>>
  cancelBooking(bookingId: string, reason?: string): Promise<BookingRecord>
}

const previewPayments = new Map<string, Promise<PreviewPaymentResult>>()
const previewBookings = new Map<string, BookingRecord>()

function assertPage(page: number, pageSize: number) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('Page and page size must be positive integers.')
  }
}

async function getAllPages<T>(api: ApiClient, path: string, pageSize = 100): Promise<T[]> {
  const items: T[] = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const separator = path.includes('?') ? '&' : '?'
    const result = await api.request<PaginatedResult<T> | T[]>(
      `${path}${separator}page=${page}&pageSize=${pageSize}`,
    )
    if (Array.isArray(result)) return [...items, ...result]
    if (!Array.isArray(result.items) || result.page !== page || !Number.isInteger(result.pageSize)
      || result.pageSize < 1 || !Number.isInteger(result.total) || result.total < 0
      || typeof result.hasMore !== 'boolean' || (result.hasMore && result.items.length === 0)) {
      throw new ApiError('The server returned invalid pagination data.', { code: 'UNKNOWN_ERROR' })
    }
    items.push(...result.items)
    hasMore = result.hasMore
    page += 1
  }
  return items
}

export const previewPlatformService: PlatformService = {
  async getRoutes() {
    return initialRoutes
  },
  async getRides(request) {
    return previewRides.filter((ride) => ride.routeIds?.includes(request.routeId) === true
      && matchesDepartureWindow(ride.departure, request.departure))
  },
  async getDriverTrips() {
    return initialDriverTrips
  },
  simulatePayment(request) {
    const existing = previewPayments.get(request.idempotencyKey)
    if (existing) return existing
    const result = new Promise<PreviewPaymentResult>((resolve) => {
      window.setTimeout(() => resolve({
        paymentId: `PRE-PAY-${request.idempotencyKey}`,
        amount: request.amount,
        status: request.outcome,
      }), 350)
    })
    previewPayments.set(request.idempotencyKey, result)
    return result
  },
  async createBooking(request) {
    const existing = previewBookings.get(request.idempotencyKey)
    if (existing) return existing

    const route = initialRoutes.find((item) => item.id === request.routeId)
    const ride = previewRides.find((item) => item.id === request.rideId
      && item.routeIds?.includes(request.routeId)
      && matchesDepartureWindow(item.departure, request.departure))
    const fare = route ? getJourneyFare(route, request.pickupIndex, request.dropoffIndex) : null
    const pickup = route?.stops[request.pickupIndex]
    const dropoff = route?.stops[request.dropoffIndex]
    const now = new Date()
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    if (!route || !ride || fare === null || !pickup || !dropoff || request.travelDate < today) {
      throw new ApiError('The preview booking details are invalid or no longer available.', {
        code: 'VALIDATION_ERROR',
      })
    }

    const booking: BookingRecord = {
      id: `PRE-${crypto.randomUUID()}`,
      bookingCode: `PRE-${String(previewBookings.size + 1).padStart(5, '0')}`,
      status: 'pending_payment',
      routeId: route.id,
      routeName: route.name,
      pickup,
      dropoff,
      travelDate: request.travelDate,
      departure: ride.departure,
      rideId: ride.id,
      vehicle: ride.vehicle,
      driver: ride.driver,
      totalFare: fare,
      createdAt: new Date().toISOString(),
    }
    previewBookings.set(request.idempotencyKey, booking)
    return booking
  },
  async getBookings(page = 1, pageSize = 20) {
    assertPage(page, pageSize)
    const items = [...previewBookings.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    const start = (page - 1) * pageSize
    return {
      items: items.slice(start, start + pageSize),
      page,
      pageSize,
      total: items.length,
      hasMore: start + pageSize < items.length,
    }
  },
  async cancelBooking(bookingId) {
    const entry = [...previewBookings.entries()].find(([, booking]) => booking.id === bookingId)
    if (!entry) {
      throw new ApiError('The booking was not found in preview data.', { code: 'NOT_FOUND', status: 404 })
    }
    const [key, booking] = entry
    if (booking.status !== 'pending_payment' && booking.status !== 'confirmed') {
      throw new ApiError('This preview booking cannot be cancelled in its current state.', {
        code: 'CONFLICT',
        status: 409,
      })
    }
    const updated = { ...booking, status: 'cancelled' as const }
    previewBookings.set(key, updated)
    return updated
  },
}

function createApiPlatformService(api: ApiClient): PlatformService {
  return {
    getRoutes: () => getAllPages<Route>(api, '/v1/routes?status=published'),
    getRides: (request) => {
      const params = new URLSearchParams({
        routeId: request.routeId,
        travelDate: request.travelDate,
        departure: request.departure,
        pickupIndex: String(request.pickupIndex),
        dropoffIndex: String(request.dropoffIndex),
      })
      return getAllPages<PreviewRide>(api, `/v1/rides?${params.toString()}`)
    },
    getDriverTrips: () => getAllPages<DriverTrip>(api, '/v1/driver/trips'),
    simulatePayment: async () => {
      throw new ApiError('Payment simulation is disabled in API mode. A verified payment flow is not connected.', {
        code: 'FORBIDDEN',
        status: 403,
      })
    },
    createBooking: ({ idempotencyKey, ...request }) => api.request<BookingRecord>('/v1/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(request),
    }),
    getBookings: async (page = 1, pageSize = 20) => {
      assertPage(page, pageSize)
      return api.request<PaginatedResult<BookingRecord> | BookingRecord[]>(
        `/v1/bookings?page=${page}&pageSize=${pageSize}`,
      ).then((result) => Array.isArray(result)
        ? { items: result, page, pageSize, total: result.length, hasMore: false }
        : result)
    },
    cancelBooking: (bookingId, reason) => api.request<BookingRecord>(
      `/v1/bookings/${encodeURIComponent(bookingId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
  }
}

export interface PlatformServiceSelection {
  service: PlatformService
  isPreviewMode: boolean
  configurationError: string | null
}

function unavailableService(message: string): PlatformService {
  const fail = async <T>(): Promise<T> => {
    throw new ApiError(message, { code: 'UNKNOWN_ERROR' })
  }
  return {
    getRoutes: () => fail(),
    getRides: () => fail(),
    getDriverTrips: () => fail(),
    simulatePayment: () => fail(),
    createBooking: () => fail(),
    getBookings: () => fail(),
    cancelBooking: () => fail(),
  }
}

export function selectPlatformService(
  modeValue: string | undefined,
  apiBaseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): PlatformServiceSelection {
  const mode = modeValue?.trim().toLowerCase() || 'preview'
  if (mode === 'preview') return { service: previewPlatformService, isPreviewMode: true, configurationError: null }
  if (mode !== 'api') {
    const message = `Unsupported VITE_DATA_MODE "${modeValue}". Use "preview" or "api".`
    return { service: unavailableService(message), isPreviewMode: false, configurationError: message }
  }

  if (!apiBaseUrl?.trim()) {
    const message = 'VITE_DATA_MODE is set to "api" but VITE_API_BASE_URL is missing.'
    return { service: unavailableService(message), isPreviewMode: false, configurationError: message }
  }

  try {
    const service = createApiPlatformService(new ApiClient(apiBaseUrl, fetcher))
    return { service, isPreviewMode: false, configurationError: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The API configuration is invalid.'
    return { service: unavailableService(message), isPreviewMode: false, configurationError: message }
  }
}

const platformSelection = selectPlatformService(
  import.meta.env?.VITE_DATA_MODE,
  import.meta.env?.VITE_API_BASE_URL,
)

export const platformService = platformSelection.service
export const isPreviewMode = platformSelection.isPreviewMode
export const platformConfigurationError = platformSelection.configurationError
