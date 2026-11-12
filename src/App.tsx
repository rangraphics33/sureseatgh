import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, BadgeCheck, Bell, Bus, CalendarDays,
  Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, CreditCard,
  FileCheck2, Headphones, Home, LayoutDashboard, MapPin,
  Moon, MoreHorizontal, Navigation, Plus, Search, Settings, ShieldCheck, Sun, Ticket,
  UserRound, Wallet, X,
} from 'lucide-react'
import heroVan from './assets/a_realistic_high_resolution_png_cutout_of_the_sam.png'
import { DashboardSkeleton, SectionSkeleton, Skeleton } from './components/Skeleton'
import LandingPage from './components/LandingPage'
import { adminPreviewRows, passengerManifest, previewRides } from './data/previewData'
import type { DriverTrip } from './data/previewData'
import { initialRoutes } from './data/routes'
import type { Route } from './data/routes'
import { isPreviewMode, platformConfigurationError, platformService } from './services/platform'
import type { BookingRecord, PaginatedResult } from './services/platform'
import { ensureStarterTransportRoutes, getTransportRoutes, saveTransportRoute } from './services/transportRoutes'
import { transportBookingService } from './services/transportBookings'
import SubscriptionScreen from './features/subscriptions/SubscriptionScreen'
import type { SubscriptionSnapshot } from './features/subscriptions/SubscriptionScreen'
import DriverApplicationReview from './features/admin/DriverApplicationReview'
import IdentityVerificationReview from './features/admin/IdentityVerificationReview'
import AdminDashboard from './features/admin/AdminDashboard'
import FleetManagement, { DriverAssignedVehicle } from './features/admin/FleetManagement'
import ScheduledDepartureManagement from './features/admin/ScheduledDepartureManagement'
import { canAccessWorkspacePath, getWorkspaceOptions, isAccountRestricted } from './features/auth/access.ts'
import { useAuth } from './features/auth/authContext.ts'
import type { AuthSnapshot } from './services/auth.ts'
import { addRouteStop, formatGhs, getJourneyFare, getRemainingSchedule, getRoutePricingStatus, removeRouteStop, reorderRouteStop } from './utils/pricing'
import { transportPaymentService } from './services/transportPayments.ts'
import './index.css'

type Workspace = 'Passenger' | 'Driver' | 'Admin'
type WorkspaceRoute = { workspace: Workspace; section: string } | null
type Booking = {
  id: string
  code: string
  route: string
  pickup: string
  dropoff: string
  date: string
  departure: string
  driver: string
  vehicle: string
  fare: number
  status: string
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function toBooking(record: BookingRecord, showPreviewData: boolean): Booking {
  return {
    id: record.id,
    code: record.bookingCode,
    route: record.routeName,
    pickup: record.pickup,
    dropoff: record.dropoff,
    date: record.travelDate,
    departure: record.departure,
    driver: record.driver,
    vehicle: record.vehicle,
    fare: record.totalFare,
    status: record.status === 'pending_payment'
      ? showPreviewData && record.id.startsWith('PRE-') ? 'Preview hold · pending payment' : 'Pending payment'
      : record.status.replaceAll('_', ' '),
  }
}

const navigation: Record<Workspace, { label: string; icon: ReactNode }[]> = {
  Passenger: [
    { label: 'Home', icon: <Home /> }, { label: 'Booking', icon: <Ticket /> },
    { label: 'My Trips', icon: <CalendarDays /> }, { label: 'My Subscription', icon: <Ticket /> },
  ],
  Driver: [
    { label: 'Overview', icon: <LayoutDashboard /> }, { label: 'Assigned Trips', icon: <CalendarDays /> },
    { label: 'Active Trip', icon: <Navigation /> }, { label: 'Earnings', icon: <Wallet /> },
  ],
  Admin: [
    { label: 'Overview', icon: <LayoutDashboard /> }, { label: 'Bookings', icon: <Ticket /> },
    { label: 'Trips', icon: <CalendarDays /> }, { label: 'Drivers', icon: <BadgeCheck /> },
  ],
}

const moreNavigation: Record<Workspace, { label: string; icon: ReactNode }[]> = {
  Passenger: [
    { label: 'Live Tracking', icon: <Navigation /> }, { label: 'Profile & Verification', icon: <UserRound /> },
    { label: 'Notifications', icon: <Bell /> }, { label: 'Help & Support', icon: <CircleHelp /> },
  ],
  Driver: [
    { label: 'Passenger Manifest', icon: <FileCheck2 /> }, { label: 'Driver Profile', icon: <UserRound /> },
  ],
  Admin: [
    { label: 'Passengers', icon: <UserRound /> }, { label: 'Vehicles', icon: <Bus /> },
    { label: 'Routes', icon: <Navigation /> }, { label: 'Pickup points', icon: <MapPin /> },
    { label: 'Driver applications', icon: <FileCheck2 /> },
    { label: 'Payments', icon: <CreditCard /> }, { label: 'Identity verification', icon: <FileCheck2 /> },
    { label: 'Reports & analytics', icon: <FileCheck2 /> },
    { label: 'Notifications', icon: <Bell /> }, { label: 'Platform settings', icon: <Settings /> },
  ],
}

const adminSections = ['Passengers', 'Drivers', 'Vehicles', 'Bookings', 'Payments'] as const
type AdminSection = (typeof adminSections)[number]
const adminRowKeys: Record<AdminSection, keyof typeof adminPreviewRows> = {
  Passengers: 'passengers',
  Drivers: 'drivers',
  Vehicles: 'vehicles',
  Bookings: 'bookings',
  Payments: 'payments',
}

function getWorkspaceRoute(pathname: string): WorkspaceRoute {
  const [base, sectionSlug] = pathname.split('/').filter(Boolean)
  const workspace = base?.toLowerCase() === 'passenger'
    ? 'Passenger'
    : base?.toLowerCase() === 'driver'
      ? 'Driver'
      : base?.toLowerCase() === 'admin'
        ? 'Admin'
        : null
  if (!workspace) return null
  const allItems = [...navigation[workspace], ...moreNavigation[workspace]]
  const section = allItems.find((item) => slugify(item.label) === sectionSlug)?.label
  return { workspace, section: section ?? (workspace === 'Passenger' ? 'Home' : 'Overview') }
}

function slugify(value: string) {
  return value.toLowerCase().replaceAll(' & ', '-').replaceAll(' ', '-')
}

function sectionPath(workspace: Workspace, section: string) {
  return `/${workspace.toLowerCase()}/${slugify(section)}`
}

function localDateString() {
  const date = new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function formatPackageLabel(period: NonNullable<SubscriptionSnapshot['subscription']>['period']) {
  return `${period[0].toUpperCase()}${period.slice(1)} subscription`
}

function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="page-title">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{detail}</p></div>
      {action}
    </div>
  )
}

function PreviewLabel() {
  return <span className="preview-label">PREVIEW DATA</span>
}

function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{detail}</p>{action}</div>
}

function StatCard({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <div className="panel stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{note}</small></div>
}

function App() {
  const { mode: authMode, snapshot: authSnapshot, signOut } = useAuth()
  const showPreviewData = authMode !== 'supabase' && isPreviewMode
  const [route, setDashboardRoute] = useState<WorkspaceRoute>(() => getWorkspaceRoute(window.location.pathname))
  const workspace = route?.workspace ?? null
  const section = route?.section ?? ''
  const [moreOpen, setMoreOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('sureseat-theme') === 'dark' ? 'dark' : 'light')
  const [routes, setRoutes] = useState<Route[]>([])
  const [routesLoading, setRoutesLoading] = useState(true)
  const [routesError, setRoutesError] = useState(platformConfigurationError ?? '')
  const [routesReloadKey, setRoutesReloadKey] = useState(0)
  const [selectedRouteId, setSelectedRouteId] = useState(() => new URLSearchParams(window.location.search).get('route') ?? '')
  const [selectedPickupIndex, setSelectedPickupIndex] = useState<number | null>(null)
  const [selectedDropoffIndex, setSelectedDropoffIndex] = useState<number | null>(null)
  const [travelDate, setTravelDate] = useState('')
  const [departure, setDeparture] = useState<'Morning' | 'Evening'>('Morning')
  const [rides, setRides] = useState<typeof previewRides>([])
  const [rideLoading, setRideLoading] = useState(false)
  const [rideError, setRideError] = useState('')
  const [rideSearchVersion, setRideSearchVersion] = useState(0)
  const [pendingRide, setPendingRide] = useState<(typeof previewRides)[number] | null>(null)
  const [pendingBookingKey, setPendingBookingKey] = useState('')
  const [isCreatingBooking, setIsCreatingBooking] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [bookingsError, setBookingsError] = useState('')
  const [bookingsPage, setBookingsPage] = useState(1)
  const [bookingsHasMore, setBookingsHasMore] = useState(false)
  const [bookingsReloadKey, setBookingsReloadKey] = useState(0)
  const [paymentActionId, setPaymentActionId] = useState('')
  const [subscriptionSnapshot, setSubscriptionSnapshot] = useState<SubscriptionSnapshot>({ subscription: null, renewal: null, payments: [] })
  const [driverTrips, setDriverTrips] = useState<DriverTrip[]>([])
  const [driverTripsLoading, setDriverTripsLoading] = useState(false)
  const [driverTripsError, setDriverTripsError] = useState('')
  const [driverTripsReloadKey, setDriverTripsReloadKey] = useState(0)
  const [tripCodes, setTripCodes] = useState<Record<string, string>>({})
  const [activeTripId, setActiveTripId] = useState('')
  const [endTripRequested, setEndTripRequested] = useState(false)
  const [toast, setToast] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [routeForStops, setRouteForStops] = useState('')
  const [newStop, setNewStop] = useState('')
  const [newRouteName, setNewRouteName] = useState('')
  const [newRouteVia, setNewRouteVia] = useState('')
  const [routeSaving, setRouteSaving] = useState(false)
  const [readNotifications, setReadNotifications] = useState(false)
  const [driverApplications, setDriverApplications] = useState<Record<string, string>>({})

  const activeRoute = routes.find((route) => route.id === selectedRouteId)
  const pickup = selectedPickupIndex === null ? '' : activeRoute?.stops[selectedPickupIndex] ?? ''
  const dropoff = selectedDropoffIndex === null ? '' : activeRoute?.stops[selectedDropoffIndex] ?? ''
  const journeyFare = activeRoute && getRoutePricingStatus(activeRoute).valid
    ? activeRoute.standardFare ?? null
    : null
  const dropoffOptions = selectedPickupIndex === null || !activeRoute
    ? []
    : activeRoute.stops.map((stop, index) => ({ stop, index })).filter(({ index }) => index > selectedPickupIndex)
  const stopRoute = routes.find((route) => route.id === routeForStops)
  const activeTrip = driverTrips.find((trip) => trip.id === activeTripId)
  const accountRestricted = authMode === 'supabase' && authSnapshot
    ? isAccountRestricted(authSnapshot.profile)
    : false
  const starterRoutesNeedSetup = initialRoutes.some((starter) => {
    const configured = routes.find((item) => item.name.trim().toLowerCase() === starter.name.trim().toLowerCase()
      && item.via.trim().toLowerCase() === starter.via.trim().toLowerCase())
    return !configured?.stops.length
  })
  const navItems = navigation[workspace ?? 'Passenger'].filter((item) => (
    authMode !== 'supabase' || !authSnapshot || canAccessWorkspacePath(sectionPath(workspace ?? 'Passenger', item.label), authSnapshot)
  ))
  const moreItems = moreNavigation[workspace ?? 'Passenger'].filter((item) => (
    authMode !== 'supabase' || !authSnapshot || canAccessWorkspacePath(sectionPath(workspace ?? 'Passenger', item.label), authSnapshot)
  ))
  const adminDashboardAccess = useMemo(() => ({
    roles: authSnapshot?.roles ?? [],
    permissions: authSnapshot?.permissions ?? [],
  }), [authSnapshot])
  const isMoreSection = moreItems.some((item) => item.label === section)
  const saveSubscriptionSnapshot = useCallback((snapshot: SubscriptionSnapshot) => {
    setSubscriptionSnapshot(snapshot)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('sureseat-theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    async function loadRoutes() {
      setRoutesLoading(true)
      setRoutesError('')
      try {
        const loadedRoutes = authMode === 'supabase'
          ? await getTransportRoutes()
          : await platformService.getRoutes()
        if (cancelled) return
        setRoutes(loadedRoutes)
        setRouteForStops((current) => loadedRoutes.some((item) => item.id === current)
          ? current
          : loadedRoutes[0]?.id ?? '')
        setSelectedRouteId((current) => loadedRoutes.some((item) => item.id === current)
          ? current
          : loadedRoutes.find((item) => item.published && getRoutePricingStatus(item).valid)?.id ?? '')
      } catch (error) {
        if (!cancelled) {
          setRoutes([])
          setRouteForStops('')
          setSelectedRouteId('')
          setRoutesError(getErrorMessage(error, 'Routes could not be loaded.'))
        }
      } finally {
        if (!cancelled) {
          setRoutesLoading(false)
          setIsLoading(false)
        }
      }
    }
    void loadRoutes()
    return () => { cancelled = true }
  }, [authMode, routesReloadKey])

  useEffect(() => {
    if (workspace !== 'Driver' && !(workspace === 'Admin' && showPreviewData)) return
    let cancelled = false
    async function loadDriverTrips() {
      setDriverTripsLoading(true)
      setDriverTripsError('')
      try {
        const trips = await platformService.getDriverTrips()
        if (!cancelled) setDriverTrips(trips)
      } catch (error) {
        if (!cancelled) {
          setDriverTrips([])
          setDriverTripsError(getErrorMessage(error, 'Driver trips could not be loaded.'))
        }
      } finally {
        if (!cancelled) setDriverTripsLoading(false)
      }
    }
    void loadDriverTrips()
    return () => { cancelled = true }
  }, [driverTripsReloadKey, showPreviewData, workspace])

  useEffect(() => {
    if (workspace !== 'Passenger' || section !== 'My Trips') return
    let cancelled = false
    async function loadBookings() {
      setBookingsLoading(true)
      setBookingsError('')
      try {
        const result: PaginatedResult<BookingRecord> = authMode === 'supabase'
          ? await transportBookingService.listMine(bookingsPage)
          : await platformService.getBookings(bookingsPage)
        if (cancelled) return
        const loadedBookings = result.items.map((booking) => toBooking(booking, showPreviewData))
        setBookings((current) => bookingsPage === 1
          ? loadedBookings
          : [...current.filter((booking) => !loadedBookings.some((loaded) => loaded.id === booking.id)), ...loadedBookings])
        setBookingsHasMore(result.hasMore)
      } catch (error) {
        if (!cancelled) {
          setBookingsError(getErrorMessage(error, 'Bookings could not be loaded.'))
        }
      } finally {
        if (!cancelled) setBookingsLoading(false)
      }
    }
    void loadBookings()
    return () => { cancelled = true }
  }, [authMode, bookingsPage, bookingsReloadKey, section, workspace, showPreviewData])

  useEffect(() => {
    if (authMode !== 'supabase') return
    const params = new URLSearchParams(window.location.search)
    const reference = params.get('reference')
    if (!reference) return
    params.delete('reference')
    params.delete('payment')
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    void transportPaymentService.verify({ reference }).then((result) => {
      setBookingsReloadKey((key) => key + 1)
      if (result.status === 'succeeded') setToast('Payment verified and your booking is confirmed.')
      else if (result.status === 'succeeded_unapplied' || result.status === 'review_required') {
        setToast('Payment was received but needs support review. Your booking is not confirmed yet.')
      } else setToast('Payment is still processing. Use Check payment in My Trips to refresh its status.')
    }).catch((error: unknown) => {
      setToast(getErrorMessage(error, 'Payment could not be verified yet. Check again in My Trips.'))
    })
  }, [authMode])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (workspace !== 'Passenger' || section !== 'Booking') return

    const route = routes.find((candidate) => candidate.id === selectedRouteId)
    const isSearchReady = route?.published === true
      && !!route && getRoutePricingStatus(route).valid
      && selectedPickupIndex !== null
      && selectedDropoffIndex !== null
      && selectedDropoffIndex > selectedPickupIndex
      && !!travelDate && travelDate >= localDateString()
      && getJourneyFare(route, selectedPickupIndex, selectedDropoffIndex) !== null

    if (!isSearchReady || !route) return

    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (cancelled) return
      setRideLoading(true)
      try {
        const request = {
          routeId: route.id,
          travelDate,
          departure,
          pickupIndex: selectedPickupIndex!,
          dropoffIndex: selectedDropoffIndex!,
        }
        const results = authMode === 'supabase'
          ? await transportBookingService.search(request)
          : await platformService.getRides(request)
        if (!cancelled) setRides(results)
      } catch (error) {
        if (!cancelled) {
          setRideError(error instanceof Error ? error.message : 'Available rides could not be loaded.')
          setRides([])
        }
      } finally {
        if (!cancelled) setRideLoading(false)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [authMode, departure, rideSearchVersion, routes, section, selectedDropoffIndex, selectedPickupIndex, selectedRouteId, travelDate, workspace])

  function navigate(next: string) {
    if (!workspace) return
    if (accountRestricted && workspace === 'Passenger' && next === 'Booking') {
      setToast('Bookings are unavailable while identity verification is restricted. You can still review your account and contact support.')
      return
    }
    if (authMode === 'supabase' && authSnapshot
      && !canAccessWorkspacePath(sectionPath(workspace, next), authSnapshot)) {
      setToast('Your account does not have permission to open that section.')
      return
    }
    if (next !== 'Booking') {
      setRideLoading(false)
      setRides([])
    }
    window.history.pushState({}, '', sectionPath(workspace, next))
    setDashboardRoute({ workspace, section: next })
    if (next === 'My Trips') setBookingsPage(1)
    setMoreOpen(false)
    setSearch('')
  }

  async function handleSignOut() {
    try {
      await signOut()
      window.location.assign('/')
    } catch (error) {
      setToast(getErrorMessage(error, 'Could not sign out. Please try again.'))
    }
  }

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = getWorkspaceRoute(window.location.pathname)
      setDashboardRoute(nextRoute)
      if (nextRoute?.section !== 'Booking') {
        setRides([])
        setRideLoading(false)
      }
      setMoreOpen(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function selectDepartureWindow(value: 'Morning' | 'Evening') {
    setDeparture(value)
    setRides([])
    setRideLoading(Boolean(dropoff && travelDate))
    setRideError('')
    setPendingRide(null)
    setPendingBookingKey('')
    setBookingError('')
  }

  function setRoute(value: string) {
    setSelectedRouteId(value)
    setSelectedPickupIndex(null)
    setSelectedDropoffIndex(null)
    setRides([])
    setRideLoading(false)
    setRideError('')
  }

  function setPickupPoint(value: string) {
    setSelectedPickupIndex(value === '' ? null : Number(value))
    setSelectedDropoffIndex(null)
    setRides([])
    setRideLoading(false)
  }

  function bookRide(ride: (typeof previewRides)[number]) {
    setPendingRide(ride)
    setPendingBookingKey(window.crypto.randomUUID())
    setBookingError('')
  }

  async function confirmBooking() {
    if (isCreatingBooking) return
    if (!pendingRide || !activeRoute || journeyFare === null || !pickup || !dropoff
      || selectedPickupIndex === null || selectedDropoffIndex === null || !travelDate) {
      setToast('Choose a valid, priced route and destination before confirming the booking.')
      return
    }
    setIsCreatingBooking(true)
    setBookingError('')
    try {
      const request = {
        idempotencyKey: pendingBookingKey || window.crypto.randomUUID(),
        routeId: activeRoute.id,
        travelDate,
        departure,
        pickupIndex: selectedPickupIndex,
        dropoffIndex: selectedDropoffIndex,
        rideId: pendingRide.id,
      }
      const booking = authMode === 'supabase'
        ? await transportBookingService.createHold(request)
        : await platformService.createBooking(request)
      setBookings((current) => [toBooking(booking, showPreviewData), ...current.filter((item) => item.id !== booking.id)])
      setPendingRide(null)
      setPendingBookingKey('')
      setBookingsPage(1)
      setToast(authMode !== 'supabase' && showPreviewData
        ? 'Preview booking hold created. It is not confirmed, and no payment was taken.'
        : 'Booking request created. Payment is required before it can be confirmed.')
      navigate('My Trips')
    } catch (error) {
      setBookingError(getErrorMessage(error, 'Booking could not be created. Please try again.'))
    } finally {
      setIsCreatingBooking(false)
    }
  }

  async function startTransportPayment(booking: Booking) {
    if (authMode !== 'supabase' || booking.status !== 'Pending payment' || paymentActionId) return
    setPaymentActionId(booking.id)
    try {
      const result = await transportPaymentService.initialize(booking.id)
      if (result?.authorizationUrl) {
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result?.status === 'succeeded') {
        setToast('Payment was verified. Refreshing your trips.')
        setBookingsReloadKey((key) => key + 1)
      } else if (result?.status === 'failed') {
        setToast('Paystack reports this attempt failed. Do not retry it; wait for the hold to expire, then create a new booking.')
      } else {
        setToast('Payment setup is being checked. Do not start another payment; refresh My Trips shortly.')
      }
    } catch (error) {
      setToast(getErrorMessage(error, 'Checkout could not be opened. The booking remains unconfirmed.'))
    } finally {
      setPaymentActionId('')
    }
  }

  async function checkTransportPayment(booking: Booking) {
    if (authMode !== 'supabase' || paymentActionId) return
    setPaymentActionId(booking.id)
    try {
      const result = await transportPaymentService.verify({ bookingId: booking.id })
      setBookingsReloadKey((key) => key + 1)
      if (result.status === 'succeeded') setToast('Payment verified and your booking is confirmed.')
      else if (result.status === 'succeeded_unapplied' || result.status === 'review_required') {
        setToast('Payment was received but needs support review. Your booking is not confirmed yet.')
      } else if (result.status === 'failed') {
        setToast('Paystack reports this attempt failed. Wait for the hold to expire before making another booking.')
      } else if (result.status === 'not_started') {
        setToast('No payment has been started for this booking yet. Choose Pay with Paystack to begin.')
      } else setToast('Paystack has not confirmed this payment yet. You can check again shortly.')
    } catch (error) {
      setToast(getErrorMessage(error, 'Payment status could not be checked.'))
    } finally {
      setPaymentActionId('')
    }
  }

  function startTrip(trip: DriverTrip) {
    if (!showPreviewData) {
      setToast('Trip start is not connected in API mode.')
      return
    }
    if ((tripCodes[trip.id] ?? '').trim().toUpperCase() !== trip.code) {
      setToast('That booking code does not match. Check the passenger manifest and try again.')
      return
    }
    setDriverTrips((current) => current.map((item) => item.id === trip.id ? { ...item, status: 'In progress' } : item))
    setActiveTripId(trip.id)
    setEndTripRequested(false)
    setToast('Trip started in preview mode.')
    navigate('Active Trip')
  }

  function finishTrip() {
    if (!showPreviewData) {
      setToast('Trip completion is not connected in API mode.')
      return
    }
    if (!activeTrip) return
    setDriverTrips((current) => current.map((item) => item.id === activeTrip.id ? { ...item, status: 'Completed' } : item))
    setActiveTripId('')
    setEndTripRequested(false)
    setToast('Trip marked complete in preview mode.')
  }

  function addStop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = newStop.trim()
    if (!value || !stopRoute) return
    setRoutes((current) => current.map((route) => route.id === stopRoute.id ? addRouteStop(route, value) : route))
    setNewStop('')
    setToast('Stop added. Save the route after checking the stop order.')
  }

  function addRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = newRouteName.trim()
    if (!value) return
    const id = `draft-route-${Date.now()}`
    setRoutes((current) => [...current, { id, name: value, via: newRouteVia.trim(), stops: [], standardFare: null, published: false }])
    setNewRouteName('')
    setNewRouteVia('')
    setRouteForStops(id)
    setToast('Draft route added. Configure its stops and standard fare, then save it.')
  }

  function updateRouteDetails(routeId: string, key: 'name' | 'via', value: string) {
    setRoutes((current) => current.map((route) => route.id === routeId
      ? { ...route, [key]: value, published: false }
      : route))
  }

  function moveStop(index: number, direction: -1 | 1) {
    if (!stopRoute) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= stopRoute.stops.length) return
    setRoutes((current) => current.map((route) => route.id === stopRoute.id ? reorderRouteStop(route, index, direction) : route))
  }

  function updateStandardFare(routeId: string, rawValue: string) {
    const value = rawValue === '' ? null : Number(rawValue)
    const fare = value !== null && Number.isFinite(value) && value >= 0
      && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
      ? value
      : null
    setRoutes((current) => current.map((route) => route.id === routeId ? { ...route, standardFare: fare, published: false } : route))
  }

  async function saveRoute(routeId: string, publish: boolean) {
    const route = routes.find((candidate) => candidate.id === routeId)
    if (!route || (publish && !getRoutePricingStatus(route).valid)) {
      setToast('This route needs at least two stops and one standard fare greater than zero before it can be published.')
      return
    }
    if (route.name.trim().length < 2 || !route.via.trim()) {
      setToast('Enter a route name and via description before saving.')
      return
    }
    if (authMode !== 'supabase' && !showPreviewData) {
      setToast('Route management writes are not connected for the configured API service.')
      return
    }
    setRouteSaving(true)
    try {
      const savedId = authMode === 'supabase'
        ? await saveTransportRoute({ ...route, publish })
        : route.id
      setRoutes((current) => current.map((candidate) => candidate.id === routeId
        ? { ...candidate, id: savedId, published: publish }
        : candidate))
      setRouteForStops((current) => current === routeId ? savedId : current)
      setSelectedRouteId((current) => current === routeId ? savedId : current)
      setToast(publish ? 'Route saved and published.' : showPreviewData
        ? 'Draft saved in this preview session.'
        : 'Route draft saved.')
    } catch (error) {
      setToast(getErrorMessage(error, 'Route could not be saved.'))
    } finally {
      setRouteSaving(false)
    }
  }

  async function loadSuppliedRoutes() {
    if (authMode !== 'supabase' || routeSaving) return
    setRouteSaving(true)
    try {
      const result = await ensureStarterTransportRoutes()
      setRoutes(result.routes)
      const selected = result.routes.find((route) => route.name.trim().toLowerCase() === initialRoutes[0].name.trim().toLowerCase()
        && route.via.trim().toLowerCase() === initialRoutes[0].via.trim().toLowerCase())
      setRouteForStops(selected?.id ?? result.routes[0]?.id ?? '')
      setToast(result.addedCount
        ? `Added ${result.addedCount} supplied route draft${result.addedCount === 1 ? '' : 's'} with the stop order you provided. Set each standard route fare before publishing.`
        : 'The supplied routes are already configured. Set their standard fares before publishing.')
    } catch (error) {
      setToast(getErrorMessage(error, 'Could not load the supplied route drafts. Check your route management permission and try again.'))
    } finally {
      setRouteSaving(false)
    }
  }

  function removeStop(index: number) {
    if (!stopRoute) return
    setRoutes((current) => current.map((route) => route.id === stopRoute.id ? removeRouteStop(route, index) : route))
  }

  const filteredRows = useMemo(() => {
    if (!adminSections.includes(section as AdminSection)) return []
    const rows = adminPreviewRows[adminRowKeys[section as AdminSection]]
    return rows.filter((row) => row.join(' ').toLowerCase().includes(search.toLowerCase()))
  }, [search, section])

  function renderBookingForm() {
    const availableRoutes = routes.filter((route) => route.published && getRoutePricingStatus(route).valid)
    if (routesError) {
      return <EmptyState icon={<CircleHelp />} title="Routes could not be loaded" detail={routesError} action={<button className="button button-secondary" onClick={() => setRoutesReloadKey((key) => key + 1)}>Retry</button>} />
    }
    if (!availableRoutes.length) {
      return <EmptyState icon={<MapPin />} title="Routes aren’t open for booking yet" detail="An administrator is setting fares and publishing the available routes. Please check back soon." />
    }
    return (
      <>
        <form className="panel booking-panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading"><div><p className="eyebrow">BOOKING · STEP BY STEP</p><h2>Plan your trip</h2><p className="muted">Choose a route first. No seat numbers are assigned; sit anywhere in your vehicle.</p></div><span className="stat-icon"><Navigation /></span></div>
          <div className="step-list"><span className="step-active">1 <b>Route</b></span><span className={activeRoute ? 'step-active' : ''}>2 <b>Pickup</b></span><span className={pickup ? 'step-active' : ''}>3 <b>Drop-off</b></span><span className={travelDate ? 'step-active' : ''}>4 <b>Travel</b></span></div>
          <div className="form-grid">
            <label className="field full-field">Available route
              <select value={selectedRouteId} required onChange={(event) => setRoute(event.target.value)}>
                <option value="">Select a published route</option>{availableRoutes.map((route) => <option key={route.id} value={route.id}>{route.name} via {route.via}</option>)}
              </select>
            </label>
            {activeRoute && <label className="field">Pickup point
              <select value={selectedPickupIndex === null ? '' : String(selectedPickupIndex)} required onChange={(event) => setPickupPoint(event.target.value)}>
                <option value="">Choose where to board</option>{activeRoute.stops.map((stop, index) => <option key={`${stop}-${index}`} value={index}>{stop}</option>)}
              </select>
            </label>}
            {pickup && <label className="field">Drop-off point
              <select required value={selectedDropoffIndex === null ? '' : String(selectedDropoffIndex)} onChange={(event) => {
                setSelectedDropoffIndex(event.target.value === '' ? null : Number(event.target.value))
                setRides([])
                setRideLoading(Boolean(event.target.value && travelDate))
                setRideError('')
              }}>
                <option value="">Choose your destination</option>{dropoffOptions.map(({ stop, index }) => <option key={`${stop}-${index}`} value={index}>{stop}</option>)}
              </select>
              <small>Only stops after your pickup are shown.</small>
            </label>}
            {dropoff && <label className="field">Travel date
              <input type="date" min={localDateString()} value={travelDate} required onChange={(event) => {
                setTravelDate(event.target.value)
                setRides([])
                setRideLoading(Boolean(event.target.value && dropoff))
                setRideError('')
              }} />
            </label>}
            {dropoff && <fieldset className="field departure-field"><legend>Choose a time</legend><div className="choice-row">
              {(['Morning', 'Evening'] as const).map((time) => <label className={`choice ${departure === time ? 'selected' : ''}`} key={time}>
                <input type="radio" name="departure" value={time} checked={departure === time} onChange={() => selectDepartureWindow(time)} />
                <span className="choice-label"><strong>{time === 'Morning' ? <><Sun size={17} /> Morning</> : <><Moon size={17} /> Evening</>}</strong>
                  <small>{time === 'Morning' ? 'Before 12 noon' : '12 noon onward'}</small></span>
              </label>)}
            </div></fieldset>}
          </div>
          <div className="booking-fare-preview" aria-live="polite">
            <span>Standard route fare</span>
            <strong>{journeyFare === null ? 'Select a valid route and destination' : formatGhs(journeyFare)}</strong>
          </div>
          <p className="preview-note">{authMode !== 'supabase' && showPreviewData
            ? 'Available sample rides load automatically when your route, stops, travel date and departure are selected. No ride is real or confirmed.'
            : 'Available rides are provided by the connected service. Booking confirmation and payment status are shown separately.'}</p>
        </form>
        {dropoff && travelDate && <section className="ride-list" aria-live="polite" aria-busy={rideLoading}>
          <div className="ride-results-heading"><div><p className="eyebrow">{authMode !== 'supabase' && showPreviewData ? 'SAMPLE SCHEDULE' : 'LIVE SCHEDULE'}</p><h2>{departure} departures</h2>
            <p className="muted">{travelDate} · {pickup} to {dropoff}</p></div>
            {!rideError && <span className="ride-count">{rideLoading ? 'Searching…' : `${rides.length} ${rides.length === 1 ? 'ride' : 'rides'}`}</span>}
          </div>
          {rideLoading ? <div className="card-list">{[1, 2].map((item) => <article className="panel ride-loading-card" key={item}><Skeleton className="skeleton-heading" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></article>)}</div>
            : rideError ? <EmptyState icon={<CircleHelp />} title="Rides could not be loaded" detail={rideError} action={<button className="button button-secondary" onClick={() => setRideSearchVersion((version) => version + 1)}>Retry search</button>} />
              : rides.length ? rides.map((ride) => <article className="panel ride-card" key={ride.id}>
            <div className="ride-main"><span className="ride-icon"><Bus /></span><div><h3>{ride.vehicle}</h3><p>Driver: {ride.driver}{authMode !== 'supabase' && showPreviewData && <PreviewLabel />}</p></div></div>
            <div className="ride-details"><span><Clock3 />{ride.departure}</span><span><MapPin />Pickup: {pickup}</span><span><MapPin />Drop-off: {dropoff}</span><span><UserRound />{ride.seats}{authMode !== 'supabase' && showPreviewData ? ' sample seats' : ' seats'}</span><strong>{ride.fare === undefined ? journeyFare === null ? 'Fare unavailable' : formatGhs(journeyFare) : formatGhs(ride.fare)}{authMode !== 'supabase' && showPreviewData && <small> preview fare</small>}</strong></div>
            <button type="button" className="button button-primary" onClick={() => bookRide(ride)}>Select ride <ArrowRight size={16} /></button>
          </article>)
              : <EmptyState icon={<Bus />} title={`No ${departure.toLowerCase()} rides found`} detail={`There are no rides listed for ${departure.toLowerCase()} on this route and date. Try the other departure window.`} action={<button type="button" className="button button-secondary" onClick={() => selectDepartureWindow(departure === 'Morning' ? 'Evening' : 'Morning')}>Check {departure === 'Morning' ? 'evening' : 'morning'} rides</button>} />}
        </section>}
      </>
    )
  }

  function renderPassenger() {
    switch (section) {
      case 'Booking':
        return <><PageTitle eyebrow="PASSENGER · BOOKING" title="Book a ride" detail="Route-first booking keeps your pickup and destination in the right order." />{isLoading || routesLoading ? <SectionSkeleton variant="booking" /> : renderBookingForm()}</>
      case 'My Trips':
        return <><PageTitle eyebrow="PASSENGER · TRAVEL" title="My trips" detail="Your confirmed and completed journeys appear here." />
          {isLoading || bookingsLoading ? <SectionSkeleton variant="trips" />
            : bookingsError ? <EmptyState icon={<CircleHelp />} title="Trips could not be loaded" detail={bookingsError} action={<button className="button button-secondary" onClick={() => setBookingsReloadKey((key) => key + 1)}>Retry</button>} />
              : bookings.length ? <div className="card-list">{bookings.map((booking) => <article className="panel trip-card" key={booking.id}><div className="trip-card-top"><span className="stat-icon"><Ticket /></span><span className="status-pill">{booking.status}</span></div><h2>{booking.route}</h2><p className="muted">{booking.date} · {booking.departure}</p><div className="route-points"><span>{booking.pickup}</span><ArrowRight /><span>{booking.dropoff}</span></div><div className="trip-meta"><span>Booking code <b>{booking.code}</b></span><span>{booking.vehicle} · {booking.driver}</span><b>{formatGhs(booking.fare)} {authMode !== 'supabase' && showPreviewData ? 'preview fare' : ''}</b></div>
                {authMode === 'supabase' && booking.status === 'Pending payment' && <div className="trip-payment-actions"><p className="muted">This seat is held temporarily. Paystack must verify payment before this booking is confirmed.</p><div className="button-row"><button className="button button-primary" disabled={Boolean(paymentActionId)} onClick={() => void startTransportPayment(booking)}><CreditCard />{paymentActionId === booking.id ? 'Opening secure checkout…' : 'Pay with Paystack'}</button><button className="button button-secondary" disabled={Boolean(paymentActionId)} onClick={() => void checkTransportPayment(booking)}>{paymentActionId === booking.id ? 'Checking…' : 'Check payment'}</button></div></div>}
              </article>)}
                {bookingsHasMore && <button className="button button-secondary" disabled={bookingsLoading} onClick={() => setBookingsPage((page) => page + 1)}>Load more trips</button>}
              </div>
              : <EmptyState icon={<Ticket />} title="No trips booked yet" detail={authMode !== 'supabase' && showPreviewData ? 'Your next sample trip will appear here after you create a preview booking hold.' : 'Your bookings will appear here after you make a booking.'} action={<button className="button button-primary" onClick={() => navigate('Booking')}>Book your first trip</button>} />}
        </>
      case 'My Subscription':
        return <SubscriptionScreen routes={routes} initialSnapshot={subscriptionSnapshot} onSnapshotChange={saveSubscriptionSnapshot} onToast={setToast} allowChanges={!accountRestricted} isPreviewMode={showPreviewData} />
      case 'Live Tracking':
        return showPreviewData
          ? <><PageTitle eyebrow="PASSENGER · LIVE TRACKING" title="Track your ride" detail="Location updates are not connected in this preview." />
          <div className="panel tracking-panel"><div className="tracking-map"><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-route"><span /><i /><i /><i /><b /></div><div className="map-caption"><Navigation />Preview route map</div></div><p className="preview-note">Map and vehicle position are illustrative only. Live driver location requires the future platform backend and device permissions.</p>{bookings[0] && <div className="tracking-summary"><strong>{bookings[0].route}</strong><span>{bookings[0].pickup} → {bookings[0].dropoff}</span><span className="status-pill">Booking {bookings[0].code}</span></div>}</div>
          </>
          : <><PageTitle eyebrow="PASSENGER · LIVE TRACKING" title="Track your ride" detail="Live vehicle location is not connected to the platform." /><EmptyState icon={<Navigation />} title="Live tracking unavailable" detail="No location source is connected, so no illustrative map is shown as a live position." /></>
      case 'Profile & Verification':
        return isLoading ? <><PageTitle eyebrow="PASSENGER · ACCOUNT" title="Profile & verification" detail="Manage your personal information and identity verification." /><SectionSkeleton variant="profile" /></> : <ProfileScreen toast={setToast} authSnapshot={authSnapshot} />
      case 'Notifications':
        return <><PageTitle eyebrow="PASSENGER · UPDATES" title="Notifications" detail="Important booking and trip updates, all in one place." action={<button className="button button-secondary" onClick={() => { setReadNotifications(true); setToast('Notifications marked as read.') }}>Mark all read</button>} />
          {showPreviewData
            ? <div className="card-list">{(readNotifications ? [] : ['Your SureSeat preview workspace is ready.', 'Route-first booking is available to try.']).map((message, index) => <div className="panel notification-card" key={message}><span className="stat-icon"><Bell /></span><div><strong>{message}</strong><p className="muted">{index ? 'Booking · Just now' : 'Account · Just now'}</p><PreviewLabel /></div></div>)}
              {readNotifications && <EmptyState icon={<CheckCircle2 />} title="You are all caught up" detail="New trip and account updates will appear here." />}</div>
            : <EmptyState icon={<Bell />} title="Live notifications are not connected" detail="Preview notices are hidden in authenticated mode." />}
        </>
      case 'Help & Support':
        return <><PageTitle eyebrow="PASSENGER · HELP" title="How can we help?" detail="Send a question to the SureSeat support team." /><SupportForm toast={setToast} /></>
      default:
        return <PassengerHome navigate={navigate} booking={bookings[0] ?? null} subscription={subscriptionSnapshot.subscription} routes={routes} showPreviewData={showPreviewData} passengerName={authSnapshot?.profile.full_name || 'Commuter'} />
    }
  }

  function renderDriver() {
    switch (section) {
      case 'Assigned Trips':
        return <><PageTitle eyebrow="DRIVER · SCHEDULE" title="Assigned trips" detail="Enter the booking code from a passenger manifest to start the assigned trip." />
          {isLoading || driverTripsLoading ? <SectionSkeleton variant="trips" />
            : driverTripsError ? <EmptyState icon={<CircleHelp />} title="Trips could not be loaded" detail={driverTripsError} action={<button className="button button-secondary" onClick={() => setDriverTripsReloadKey((key) => key + 1)}>Retry</button>} />
              : <div className="card-list">{driverTrips.filter((trip) => trip.status === 'Assigned').map((trip) => <article className="panel assigned-trip" key={trip.id}><div className="section-heading"><div><h2>{trip.route}</h2><p className="muted">{trip.date} · {trip.departure}</p></div><span className="status-pill">{trip.status}</span></div><div className="trip-meta"><span>{trip.passengers} passengers</span><span>Trip code <b>{trip.code}</b></span></div>{showPreviewData && <label className="field">Passenger booking code<input value={tripCodes[trip.id] ?? ''} placeholder="e.g. SS-2401" onChange={(event) => setTripCodes((current) => ({ ...current, [trip.id]: event.target.value }))} /></label>}<button className="button button-primary" disabled={!showPreviewData} onClick={() => startTrip(trip)}>{showPreviewData ? 'Verify code & start trip' : 'Trip start not connected'} <ArrowRight size={16} /></button></article>)}
                {!driverTrips.some((trip) => trip.status === 'Assigned') && <EmptyState icon={<CheckCircle2 />} title="No assigned trips waiting" detail="Your upcoming assignments will appear here." />}
                {!showPreviewData && <p className="preview-note">Trip start and completion are read-only until their API actions and server-side authorization are connected.</p>}
              </div>}
        </>
      case 'Passenger Manifest':
        return showPreviewData
          ? <><PageTitle eyebrow="DRIVER · PASSENGERS" title="Passenger manifest" detail="Sample passenger names and pickup points for today's assigned trip." />{isLoading ? <SectionSkeleton variant="table" /> : <div className="panel"><div className="table-scroll"><table><thead><tr><th>Passenger</th><th>Pickup point</th><th>Booking code</th><th>Confirmation</th></tr></thead><tbody>{passengerManifest.map((person) => <tr key={person.code + person.name}><td>{person.name}</td><td>{person.pickup}</td><td><strong>{person.code}</strong></td><td><span className="status-pill">Preview confirmed</span></td></tr>)}</tbody></table></div><p className="preview-note">Manifest details are example data and are not linked to passengers.</p></div>}</>
          : <><PageTitle eyebrow="DRIVER · PASSENGERS" title="Passenger manifest" detail="Passenger manifest data is not connected to the driver service." /><EmptyState icon={<FileCheck2 />} title="Manifest unavailable" detail="Sample passenger names are hidden in authenticated mode." /></>
      case 'Active Trip':
        return <><PageTitle eyebrow="DRIVER · TRIP CONTROL" title="Active trip" detail="Passengers can request an end to their journey. Confirm completion when they are safely off-board." />
          {activeTrip ? <div className="panel active-trip-card"><span className="status-pill status-live">{showPreviewData ? 'Trip in progress · Preview' : 'Trip in progress'}</span><h2>{activeTrip.route}</h2><p>{activeTrip.date} · {activeTrip.departure} · {activeTrip.passengers}{showPreviewData ? ' sample passengers' : ' passengers'}</p>{showPreviewData ? <><div className={`end-request ${endTripRequested ? 'requested' : ''}`}><div><strong>{endTripRequested ? 'Passenger end-trip request received' : 'Passenger journey completion'}</strong><p>{endTripRequested ? 'Confirm after the passenger has left the vehicle.' : 'The passenger can request that their journey ends.'}</p></div>{endTripRequested && <Bell />}</div><div className="button-row"><button className="button button-secondary" onClick={() => { setEndTripRequested(true); setToast('End-trip request sent to the driver workspace.') }}>Simulate passenger request</button><button className="button button-primary" disabled={!endTripRequested} onClick={finishTrip}><Check size={17} />Confirm trip completion</button></div></> : <p className="preview-note">Passenger end-trip requests and trip completion controls are not connected.</p>}</div>
            : <EmptyState icon={<Navigation />} title="No active trip" detail="Start one of your assigned trips after verifying its booking code." action={<button className="button button-primary" onClick={() => navigate('Assigned Trips')}>View assigned trips</button>} />}
          </>
      case 'Earnings':
        return showPreviewData
          ? <><PageTitle eyebrow="DRIVER · PAYOUTS" title="Earnings" detail="Sample earnings overview. Real trip settlements are not connected." /><div className="stats-grid"><StatCard label="This week" value="GH₵ 840" note="Preview total" icon={<Wallet />} /><StatCard label="Completed trips" value="24" note="Sample records" icon={<CheckCircle2 />} /><StatCard label="Next payout" value="Pending" note="Payout setup required" icon={<Clock3 />} /></div><div className="panel"><div className="panel-heading"><h2>Recent earnings</h2><PreviewLabel /></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Route</th><th>Amount</th><th>Status</th></tr></thead><tbody><tr><td>Sample · Nov 8</td><td>Nungua → Circle</td><td>GH₵ 210</td><td>Preview only</td></tr><tr><td>Sample · Nov 7</td><td>Tema → Circle</td><td>GH₵ 175</td><td>Preview only</td></tr></tbody></table></div></div></>
          : <><PageTitle eyebrow="DRIVER · PAYOUTS" title="Earnings" detail="Trip settlement and payout reporting are not connected." /><EmptyState icon={<Wallet />} title="Earnings unavailable" detail="No live earnings or payout source is connected. No sample totals are shown." /></>
      case 'Driver Profile':
        return isLoading ? <><PageTitle eyebrow="DRIVER · ACCOUNT" title="Driver profile & vehicle" detail="Review your approved driver account and assigned vehicle." /><SectionSkeleton variant="profile" /></> : <DriverProfile showPreviewData={showPreviewData} authSnapshot={authSnapshot} />
      default:
        return <><PageTitle eyebrow="DRIVER WORKSPACE" title={showPreviewData ? 'Driver overview · Preview' : 'Driver overview'} detail="Your assigned trips and vehicle status." /><div className="stats-grid">{isLoading ? <DashboardSkeleton /> : <><StatCard label="Trips today" value={String(driverTrips.filter((trip) => trip.status !== 'Completed').length)} note={showPreviewData ? 'Assigned sample trips' : 'From connected trip service'} icon={<Bus />} /><StatCard label="Passengers" value={showPreviewData ? '39' : 'Not connected'} note={showPreviewData ? "Across today's sample trips" : 'Passenger totals are unavailable'} icon={<UserRound />} /><StatCard label="Verification" value={showPreviewData ? 'Approved · Preview' : authSnapshot?.driverApplicationStatus ?? 'Unavailable'} note={showPreviewData ? 'Preview status' : 'Driver application status'} icon={<ShieldCheck />} /></>}</div>{showPreviewData ? <div className="panel panel-action"><div><h2>Next assigned trip · Preview</h2><p className="muted">Nungua → Circle via Beach Road · 6:30 AM</p><span className="preview-note">Use a passenger booking code to start this sample trip.</span></div><button className="button button-primary" onClick={() => navigate('Assigned Trips')}>Open assigned trips <ArrowRight size={16} /></button></div> : driverTrips.find((trip) => trip.status === 'Assigned') ? <div className="panel panel-action"><div><h2>Next assigned trip</h2><p className="muted">{driverTrips.find((trip) => trip.status === 'Assigned')?.route} · {driverTrips.find((trip) => trip.status === 'Assigned')?.date}</p><span className="preview-note">Trip control actions depend on the connected API.</span></div><button className="button button-primary" onClick={() => navigate('Assigned Trips')}>Open assigned trips <ArrowRight size={16} /></button></div> : <div className="panel"><p className="muted">No upcoming trip data is available.</p></div>}{showPreviewData ? <div className="panel"><div className="panel-heading"><h2>Before you drive</h2><span className="status-pill">Preview verification</span></div><div className="check-list"><p><CheckCircle2 /> Driver photograph <span>On file · Preview</span></p><p><CheckCircle2 /> Ghana Card <span>Verified · Preview</span></p><p><CheckCircle2 /> Driver licence <span>Verified · Preview</span></p><p><Clock3 /> Vehicle insurance <span>Sample expires 30 Dec</span></p></div></div> : <DriverAssignedVehicle />}</>
    }
  }

  function renderAdmin() {
    if (section === 'Vehicles') {
      if (authMode === 'supabase' && authSnapshot
        && !canAccessWorkspacePath(sectionPath('Admin', 'Vehicles'), authSnapshot)) {
        return <><PageTitle eyebrow="ADMIN · FLEET" title="Vehicle & fleet management" detail="Fleet access is permission controlled." /><EmptyState icon={<ShieldCheck />} title="Permission required" detail="Your account does not have the vehicles.manage permission." /></>
      }
      return <FleetManagement isSupabaseMode={authMode === 'supabase'} />
    }
    if (section === 'Driver applications') {
      if (authMode !== 'supabase') {
        return <><PageTitle eyebrow="ADMIN · DRIVER ONBOARDING" title="Driver applications" detail="Secure Driver application review is available only in authenticated Supabase mode." /><EmptyState icon={<ShieldCheck />} title="Review centre unavailable in preview" detail="No sample Driver documents are shown or processed in preview mode." /></>
      }
      return <><PageTitle eyebrow="ADMIN · DRIVER ONBOARDING" title="Driver applications" detail="Review all five private onboarding documents before recording a decision." /><DriverApplicationReview /></>
    }

    if (section === 'Identity verification') {
      if (authMode !== 'supabase') {
        return <><PageTitle eyebrow="ADMIN · IDENTITY & ACCESS" title="Identity verification" detail="Secure document review is available only in authenticated Supabase mode." /><EmptyState icon={<ShieldCheck />} title="Review centre unavailable in preview" detail="No sample identity documents are shown or processed in preview mode." /></>
      }
      return <><PageTitle eyebrow="ADMIN · IDENTITY & ACCESS" title="Identity verification" detail="Review Ghana Card submissions using private documents and audited decisions." /><IdentityVerificationReview /></>
    }

    if (adminSections.includes(section as AdminSection)) {
      if (!showPreviewData) return <><PageTitle eyebrow={`ADMIN · ${section.toUpperCase()}`} title={`${section} management`} detail={`Manage ${section.toLowerCase()} when its administration tools are available.`} /><EmptyState icon={<CircleHelp />} title={`${section} tools are not available yet`} detail="This workspace does not have connected management tools for this section. No sample records are shown." /></>
      if (isLoading) return <><PageTitle eyebrow={`ADMIN · ${section.toUpperCase()}`} title={`${section} management`} detail="Review sample management records." /><SectionSkeleton variant="table" /></>
      const columnNames: Record<AdminSection, string[]> = {
        Passengers: ['Passenger', 'Email', 'Verification'],
        Drivers: ['Driver', 'Vehicle', 'Application status'],
        Vehicles: ['Registration', 'Vehicle type', 'Status'],
        Bookings: ['Booking code', 'Passenger', 'Route', 'Status'],
        Payments: ['Payment ID', 'Booking', 'Amount', 'Status'],
      }
      return <><PageTitle eyebrow={`ADMIN · ${section.toUpperCase()}`} title={`${section} management`} detail={`Review and manage ${section.toLowerCase()} using clearly labeled sample records.`} action={<div className="search-field"><Search /><input aria-label={`Search ${section}`} placeholder="Search records" value={search} onChange={(event) => setSearch(event.target.value)} /></div>} /><div className="panel"><div className="panel-heading"><h2>{filteredRows.length} sample records</h2><PreviewLabel /></div><div className="table-scroll"><table><thead><tr>{columnNames[section as AdminSection].map((heading) => <th key={heading}>{heading}</th>)}{section === 'Drivers' && <th>Review action</th>}</tr></thead><tbody>{filteredRows.map((row) => { const original = adminPreviewRows[adminRowKeys[section as AdminSection]].indexOf(row); const status = driverApplications[String(original)] ?? row[row.length - 1]; return <tr key={row[0]}>{row.slice(0, -1).map((cell) => <td key={cell}>{cell}</td>)}<td><span className="status-pill">{status}</span></td>{section === 'Drivers' && <td><div className="button-row compact"><button className="button button-secondary" onClick={() => { setDriverApplications((current) => ({ ...current, [original]: 'Approved · Preview' })); setToast('Sample driver application approved in preview.') }}>Approve</button><button className="button button-danger" onClick={() => { setDriverApplications((current) => ({ ...current, [original]: 'Rejected · Preview' })); setToast('Sample driver application rejected in preview.') }}>Reject</button></div></td>}</tr>})}</tbody></table>{!filteredRows.length && <EmptyState icon={<Search />} title="No matching records" detail="Try changing your search." />}</div><p className="preview-note">Sample management records only. Changes are not saved to a live platform.</p></div></>
    }

    const stopRoutePricingStatus = stopRoute ? getRoutePricingStatus(stopRoute) : null

    switch (section) {
      case 'Routes':
        if (!stopRoute || !stopRoutePricingStatus) return <><PageTitle eyebrow="ADMIN · ROUTES & PRICING" title="Routes and standard fares" detail="Set one fare for every passenger travelling on a route, then manage its ordered pickup and drop-off stops." />{authMode === 'supabase' && starterRoutesNeedSetup && <div className="panel panel-action"><div><h2>Load the supplied routes</h2><p className="muted">Adds the Tema → Circle and Nungua → Circle stop lists as drafts. Their previous illustrative prices are not copied.</p></div><button className="button button-primary" type="button" disabled={routeSaving || routesLoading || !!routesError} onClick={() => void loadSuppliedRoutes()}>{routeSaving ? 'Adding route drafts…' : 'Add supplied routes'}</button></div>}<form className="panel inline-form" onSubmit={addRoute}><label className="field">Route name<input value={newRouteName} onChange={(event) => setNewRouteName(event.target.value)} placeholder="e.g. Madina → Circle" required /></label><label className="field">Via<input value={newRouteVia} onChange={(event) => setNewRouteVia(event.target.value)} placeholder="e.g. Atomic Junction" required /></label><button className="button button-primary"><Plus />Create route draft</button></form>{routesLoading ? <SectionSkeleton variant="table" /> : routesError ? <EmptyState icon={<MapPin />} title="Routes could not be loaded" detail={routesError} action={<button className="button button-secondary" onClick={() => setRoutesReloadKey((key) => key + 1)}>Retry</button>} /> : <EmptyState icon={<MapPin />} title="No routes configured" detail="Add a supplied route or create a draft. Set its standard fare and ordered stops before publishing it." />}</>
        if (authMode !== 'supabase' && !showPreviewData) return <><PageTitle eyebrow="ADMIN · ROUTES & PRICING" title="Routes and standard fares" detail="Review route information and standard fares." /><div className="panel"><p className="preview-note">Route editing and publishing are not available for the current connection.</p><div className="table-scroll"><table><thead><tr><th>Route</th><th>Via</th><th>Stops</th><th>Standard fare</th></tr></thead><tbody>{routes.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.via}</td><td>{item.stops.length}</td><td>{item.standardFare === null || item.standardFare === undefined ? 'Not set' : formatGhs(item.standardFare)}</td></tr>)}</tbody></table></div></div></>
        return <>
          <PageTitle eyebrow="ADMIN · ROUTES & PRICING" title="Routes and standard fares" detail="Set one fare for the route. Passengers pay the same amount whichever valid pickup and drop-off stops they select." />
          {authMode === 'supabase' && starterRoutesNeedSetup && <div className="panel panel-action"><div><h2>Load the routes you provided</h2><p className="muted">Adds missing route stop lists as drafts only. You’ll enter the approved fares before publishing.</p></div><button className="button button-secondary" type="button" disabled={routeSaving} onClick={() => void loadSuppliedRoutes()}>{routeSaving ? 'Adding route drafts…' : 'Add supplied routes'}</button></div>}
          <form className="panel inline-form" onSubmit={addRoute}>
            <label className="field">New route name<input value={newRouteName} onChange={(event) => setNewRouteName(event.target.value)} placeholder="e.g. Madina → Circle" required /></label>
            <label className="field">Via<input value={newRouteVia} onChange={(event) => setNewRouteVia(event.target.value)} placeholder="e.g. Atomic Junction" required /></label>
            <button className="button button-primary"><Plus />Add route</button>
          </form>
          <div className="panel route-editor">
            <label className="field">Choose route
              <select value={routeForStops} onChange={(event) => setRouteForStops(event.target.value)}>
                {routes.map((route) => <option key={route.id} value={route.id}>{route.name} · {route.via}</option>)}
              </select>
            </label>
            <div className="route-pricing-summary">
              <div><p className="eyebrow">ROUTE FARE</p><h2>{stopRoute.name}</h2><p className="muted">{stopRoute.stops.length} ordered pickup and drop-off stops</p></div>
              <span className={`status-pill ${stopRoutePricingStatus.valid ? 'pricing-valid' : 'pricing-invalid'}`}>{stopRoute.published && stopRoutePricingStatus.valid ? 'Published' : stopRoutePricingStatus.valid ? 'Valid · unpublished' : 'Pricing incomplete'}</span>
            </div>
            <div className="form-grid route-target-grid">
              <label className="field">Route name
                <input value={stopRoute.name} onChange={(event) => updateRouteDetails(stopRoute.id, 'name', event.target.value)} required />
              </label>
              <label className="field">Via
                <input value={stopRoute.via} onChange={(event) => updateRouteDetails(stopRoute.id, 'via', event.target.value)} required />
              </label>
            </div>
            <div className="form-grid route-target-grid">
              <label className="field">Standard one-way route fare (GH₵)
                <input type="number" min="0.01" step="0.01" value={stopRoute.standardFare ?? ''} aria-invalid={!getRoutePricingStatus(stopRoute).valid && stopRoute.standardFare !== null} onChange={(event) => updateStandardFare(stopRoute.id, event.target.value)} placeholder="Enter approved fare" />
                <small>Every passenger pays this amount regardless of their pickup and drop-off stops.</small>
              </label>
              <div className="route-validation-totals"><span>Passenger fare <strong>{stopRoutePricingStatus.standardFare === null ? 'Not set' : formatGhs(stopRoutePricingStatus.standardFare)}</strong></span><span className="route-validation-message">{stopRoutePricingStatus.message}</span></div>
            </div>
            {!stopRoute.stops.length && <EmptyState icon={<MapPin />} title="No stops configured" detail="Add ordered pickup and drop-off stops before publishing." action={<button className="button button-secondary" onClick={() => navigate('Pickup points')}>Add stops</button>} />}
            <div className="route-pricing-actions">
              <div className="button-row">
                <button className="button button-secondary" type="button" disabled={routeSaving} onClick={() => void saveRoute(stopRoute.id, false)}>{routeSaving ? 'Saving…' : 'Save draft'}</button>
                <button className="button button-primary" type="button" disabled={!stopRoutePricingStatus.valid || routeSaving} onClick={() => void saveRoute(stopRoute.id, true)}>{routeSaving ? 'Saving…' : stopRoute.published ? 'Save and publish' : 'Save and publish route'}</button>
              </div>
            </div>
            <p className="preview-note">The route must have at least two stops and a standard fare before it can be published. Saving requires the routes.manage permission and is recorded in the audit log.</p>
          </div>
        </>
      case 'Pickup points':
        if (!stopRoute) return <><PageTitle eyebrow="ADMIN · NETWORK" title="Pickup point management" detail="Manage ordered route stops." />{routesLoading ? <SectionSkeleton variant="table" /> : <EmptyState icon={<MapPin />} title={routesError ? 'Routes could not be loaded' : 'No routes available'} detail={routesError || 'Routes will appear here when the route service has data.'} action={routesError ? <button className="button button-secondary" onClick={() => setRoutesReloadKey((key) => key + 1)}>Retry</button> : undefined} />}</>
        if (authMode !== 'supabase' && !showPreviewData) return <><PageTitle eyebrow="ADMIN · NETWORK" title="Pickup point management" detail="Published route information is read-only in API mode." /><div className="panel"><p className="preview-note">Adding, removing, and reordering stops requires the connected admin route service.</p><div className="stop-list">{stopRoute.stops.map((stop, index) => <div className="stop-row" key={`${stop}-${index}`}><span className="stop-index">{index + 1}</span><strong>{stop}</strong></div>)}</div></div></>
        return <><PageTitle eyebrow="ADMIN · NETWORK" title="Pickup point management" detail="Add, remove and reorder boarding and drop-off stops. Changes take effect when you save the route." /><div className="panel"><label className="field">Choose route<select value={routeForStops} onChange={(event) => setRouteForStops(event.target.value)}>{routes.map((route) => <option key={route.id} value={route.id}>{route.name} · {route.via}</option>)}</select></label><form className="inline-form" onSubmit={addStop}><label className="field">New stop<input value={newStop} onChange={(event) => setNewStop(event.target.value)} required placeholder="Enter pickup point" /></label><button className="button button-primary"><Plus />Add stop</button></form><div className="stop-list">{stopRoute.stops.map((stop, index) => <div className="stop-row" key={`${stop}-${index}`}><span className="stop-index">{index + 1}</span><strong>{stop}</strong><div><button className="icon-button" aria-label={`Move ${stop} up`} disabled={index === 0} onClick={() => moveStop(index, -1)}><ArrowUp /></button><button className="icon-button" aria-label={`Move ${stop} down`} disabled={index === stopRoute.stops.length - 1} onClick={() => moveStop(index, 1)}><ArrowDown /></button><button className="icon-button danger-icon" aria-label={`Remove ${stop}`} onClick={() => removeStop(index)}><X /></button></div></div>)}</div><div className="button-row"><button className="button button-secondary" onClick={() => void saveRoute(stopRoute.id, false)} disabled={routeSaving}>{routeSaving ? 'Saving…' : 'Save route draft'}</button><button className="button button-secondary" onClick={() => navigate('Routes')}>Review standard fare</button></div></div></>
      case 'Trips':
        if (authMode === 'supabase') return <ScheduledDepartureManagement />
        if (!showPreviewData) return <><PageTitle eyebrow="ADMIN · OPERATIONS" title="Trip monitoring" detail="Authorized admin trip reporting is not connected." /><EmptyState icon={<CalendarDays />} title="No live trip feed available" detail="The current API exposes driver-scoped trip records, not an authorized Admin trip feed. No driver-specific data is shown here." /></>
        return <><PageTitle eyebrow="ADMIN · OPERATIONS" title="Trip monitoring" detail="Preview trip data. These are sample records, not live operations." />{driverTripsError ? <EmptyState icon={<CircleHelp />} title="Trips could not be loaded" detail={driverTripsError} action={<button className="button button-secondary" onClick={() => setDriverTripsReloadKey((key) => key + 1)}>Retry</button>} /> : driverTrips.length ? <div className="panel"><div className="table-scroll"><table><thead><tr><th>Trip</th><th>Route</th><th>Departure</th><th>Passengers</th><th>Status</th></tr></thead><tbody>{driverTrips.map((trip) => <tr key={trip.id}><td>{trip.code}</td><td>{trip.route}</td><td>{trip.date} · {trip.departure}</td><td>{trip.passengers} · sample</td><td><span className="status-pill">{trip.status}</span></td></tr>)}</tbody></table></div><p className="preview-note">All trip entries and passenger counts are sample data.</p></div> : <EmptyState icon={<CalendarDays />} title="No sample trip records available" detail="No preview trips are currently configured." />}</>
      case 'Reports & analytics':
        return showPreviewData
          ? <><PageTitle eyebrow="ADMIN · INSIGHTS" title="Reports & analytics" detail="Preview-only indicators. These are illustrative and are not live reporting." /><div className="stats-grid"><StatCard label="Bookings this month" value="1,284" note="Illustrative sample" icon={<Ticket />} /><StatCard label="Completed journeys" value="962" note="Illustrative sample" icon={<CheckCircle2 />} /><StatCard label="Gross payment volume" value="GH₵ 36,520" note="Illustrative sample" icon={<CreditCard />} /></div><div className="panel"><div className="panel-heading"><h2>Platform activity</h2><PreviewLabel /></div><div className="report-bars">{[['Bookings', 78], ['Completed trips', 61], ['Driver onboarding', 42], ['Payment settlement', 68]].map(([label, percent]) => <div className="report-bar" key={label}><span>{label}</span><div><i style={{ width: `${percent}%` }} /></div><b>{percent}%</b></div>)}</div></div></>
          : <><PageTitle eyebrow="ADMIN · INSIGHTS" title="Reports & analytics" detail="Reporting is not connected to an authorized analytics source." /><EmptyState icon={<FileCheck2 />} title="No live reports available" detail="Bookings, trip, payment, and subscription reporting endpoints are not present in the current schema. No sample totals are shown." /></>
      case 'Notifications':
        return showPreviewData
          ? <><PageTitle eyebrow="ADMIN · PLATFORM" title="Platform notifications" detail="Sample operational messages for the preview workspace." action={<button className="button button-secondary" onClick={() => { setReadNotifications(true); setToast('Preview notifications marked as read.') }}>Mark all read</button>} />{readNotifications ? <EmptyState icon={<CheckCircle2 />} title="No sample notifications" detail="You are up to date in this preview session." /> : <div className="card-list"><div className="panel notification-card"><Bell /><div><strong>New driver application needs review</strong><p className="muted">Sample application</p><PreviewLabel /></div></div><div className="panel notification-card"><ShieldCheck /><div><strong>Sample vehicle insurance review</strong><p className="muted">Sample record</p><PreviewLabel /></div></div></div>}</>
          : <><PageTitle eyebrow="ADMIN · PLATFORM" title="Platform notifications" detail="Live notification delivery is not connected." /><EmptyState icon={<Bell />} title="No live notifications available" detail="Sample notifications are hidden in authenticated mode." /></>
      case 'Platform settings':
      return <><PageTitle eyebrow="ADMIN · PLATFORM" title="Platform settings" detail="Manage display preferences and review how this workspace is connected." /><div className="panel settings-list"><div><span><strong>Appearance</strong><small>Choose the display theme for all workspaces.</small></span><button className="button button-secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon /> : <Sun />}{theme === 'light' ? 'Dark mode' : 'Light mode'}</button></div><div><span><strong>Authentication</strong><small>Access is controlled by your signed-in account and assigned permissions.</small></span><span className="status-pill">{authMode === 'supabase' ? 'Connected' : 'Preview'}</span></div><div><span><strong>Data provider</strong><small>{authMode === 'supabase' ? 'Routes and transport bookings use the SureSeat database.' : 'Preview records are isolated from live services.'}</small></span>{showPreviewData ? <PreviewLabel /> : <span className="status-pill">{authMode === 'supabase' ? 'Supabase' : 'Unavailable'}</span>}</div></div></>
      default:
        return <AdminDashboard
          access={adminDashboardAccess}
          isPreviewMode={showPreviewData}
          isSupabaseMode={authMode === 'supabase'}
          shortcuts={[...navigation.Admin, ...moreNavigation.Admin]
            .filter((item) => item.label !== 'Overview' && (authMode !== 'supabase' || !authSnapshot || canAccessWorkspacePath(sectionPath('Admin', item.label), authSnapshot)))
            .map((item) => ({ ...item, onClick: () => navigate(item.label) }))}
        />
    }
  }

  const activeTripCount = driverTrips.filter((trip) => trip.status === 'In progress').length

  if (!workspace) return <LandingPage
    theme={theme}
    routes={routes}
    routesLoading={routesLoading}
    routesError={routesError}
    isPreviewMode={showPreviewData}
    onRetryRoutes={() => setRoutesReloadKey((key) => key + 1)}
    onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
  />

  return (
    <div className={`app-shell ${workspace.toLowerCase()}-workspace`}>
      <aside className="sidebar">
        <a className="brand" href={sectionPath(workspace, workspace === 'Passenger' ? 'Home' : 'Overview')} onClick={(event) => { event.preventDefault(); navigate(workspace === 'Passenger' ? 'Home' : 'Overview') }}><span className="brand-mark">S</span><span>Sure<span className="brand-gold">Seat</span></span></a>
        <div className="dashboard-label"><span>{workspace}</span><small>Dashboard</small></div>
        <nav className="side-nav" aria-label={`${workspace} navigation`}>
          {navItems.map((item) => <button key={item.label} className={`nav-link ${section === item.label ? 'active' : ''}`} aria-current={section === item.label ? 'page' : undefined} onClick={() => navigate(item.label)}><span className="nav-link-icon">{item.icon}</span><span>{item.label}</span>{item.label === 'Active Trip' && activeTripCount > 0 && <span className="nav-count">{activeTripCount}</span>}</button>)}
          <button type="button" className={`nav-link more-toggle ${moreOpen || isMoreSection ? 'active' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><span className="nav-link-icon"><MoreHorizontal /></span><span>More</span><ChevronDown className={moreOpen ? 'chevron-open' : ''} /></button>
          {moreOpen && <div className="more-menu more-menu-desktop" aria-label="More navigation">{moreItems.map((item) => <button key={item.label} className={`nav-link ${section === item.label ? 'active' : ''}`} aria-current={section === item.label ? 'page' : undefined} onClick={() => navigate(item.label)}><span className="nav-link-icon">{item.icon}</span><span>{item.label}</span></button>)}</div>}
        </nav>
        <div className="sidebar-footer"><div className="support-mini"><Headphones /><span><b>Need a hand?</b><small>We are here to help</small></span></div><span>SureSeat Ghana · {workspace} dashboard</span></div>
      </aside>
      <main className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">S</span><strong>Sure<span className="brand-gold">Seat</span></strong></div>
          <div className="topbar-context"><span className="workspace-chip">{workspace} dashboard</span>{showPreviewData && <PreviewLabel />}</div>
          <div className="topbar-actions">
            <button className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon /> : <Sun />}</button>
            <button className="icon-button notification-toggle" aria-label="Open notifications" onClick={() => navigate(workspace === 'Passenger' ? 'Notifications' : workspace === 'Admin' ? 'Notifications' : 'Active Trip')}><Bell />{(!readNotifications || endTripRequested) && <i />}</button>
            {authSnapshot && <div className="user-chip"><span className="avatar">{(authSnapshot.profile.full_name?.trim().charAt(0) || authSnapshot.user.email?.charAt(0) || 'S').toUpperCase()}</span><span>{authSnapshot.profile.full_name || authSnapshot.user.email || 'SureSeat account'}<small>{accountRestricted ? 'Verification required' : 'Signed in'}</small></span></div>}
            {!authSnapshot && <div className="user-chip"><span className="avatar">{workspace === 'Admin' ? 'A' : workspace === 'Driver' ? 'K' : 'C'}</span><span>{workspace === 'Admin' ? 'Admin' : workspace === 'Driver' ? 'Kwame Mensah' : 'Commuter'}<small>Preview account</small></span></div>}
            {authSnapshot && getWorkspaceOptions(authSnapshot).length > 1 && <button className="icon-button" aria-label="Switch workspace" title="Switch workspace" onClick={() => window.location.assign('/workspace')}><LayoutDashboard /></button>}
            {authSnapshot && <button className="button button-secondary" type="button" onClick={() => void handleSignOut()}>Sign out</button>}
          </div>
        </header>
        <div className="content-area">
          {workspace === 'Passenger' ? renderPassenger() : workspace === 'Driver' ? renderDriver() : renderAdmin()}
      <footer className="page-footer">{authMode === 'supabase' ? 'Payment confirmation and live vehicle location are not available yet' : 'Preview workspace · No live bookings or payment data'} <span>Made for everyday journeys in Ghana</span></footer>
        </div>
      </main>
      {pendingRide && <div className="dialog-backdrop"><section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-confirm-title"><span className="stat-icon"><Ticket /></span><h2 id="booking-confirm-title">{authMode !== 'supabase' && showPreviewData ? 'Create a sample booking hold?' : 'Create booking hold?'}</h2><p>{activeRoute?.name} · {pickup} → {dropoff || 'Drop-off to be decided'} · {pendingRide.departure}</p><p className="preview-note">{authMode !== 'supabase' && showPreviewData
        ? 'This creates a preview hold only. It is not confirmed, and no payment will be taken.'
        : authMode === 'supabase'
          ? 'Supabase will verify the route, fare, and remaining capacity. This hold stays pending until payment is verified.'
          : 'The server must validate availability and fare. This request does not confirm the booking or verify payment.'}</p>{bookingError && <p className="form-error" role="alert">{bookingError}</p>}<div className="button-row"><button className="button button-secondary" disabled={isCreatingBooking} onClick={() => { setPendingRide(null); setPendingBookingKey(''); setBookingError('') }}>Go back</button><button className="button button-primary" disabled={isCreatingBooking} onClick={() => void confirmBooking()}>{isCreatingBooking ? 'Creating hold…' : authMode !== 'supabase' && showPreviewData ? 'Create preview hold' : 'Create booking hold'}</button></div></section></div>}
      {toast && <div className="toast" role="status"><CheckCircle2 />{toast}<button aria-label="Dismiss message" onClick={() => setToast('')}><X /></button></div>}
      {workspace !== 'Admin' && moreOpen && <div className="more-menu more-menu-mobile" aria-label="More navigation">{moreItems.map((item) => <button key={item.label} className={section === item.label ? 'active' : ''} aria-current={section === item.label ? 'page' : undefined} onClick={() => navigate(item.label)}><span>{item.icon}</span>{item.label}</button>)}</div>}
      {workspace !== 'Admin' && <nav className={`mobile-navigation ${workspace.toLowerCase()}-mobile-navigation`} aria-label={`${workspace} mobile navigation`}>
        {navItems.map((item) => <button className={section === item.label ? 'active' : ''} key={item.label} onClick={() => navigate(item.label)} aria-current={section === item.label ? 'page' : undefined}><span>{item.icon}</span><small>{mobileLabel(item.label)}</small></button>)}
        <button type="button" className={moreOpen || isMoreSection ? 'active' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><span><MoreHorizontal /></span><small>More</small></button>
      </nav>}
    </div>
  )
}

function mobileLabel(label: string) {
  const labels: Record<string, string> = {
    'Booking': 'Book',
    'My Trips': 'Trips',
    'Assigned Trips': 'Trips',
    'Passenger Manifest': 'Manifest',
    'Overview': 'Home',
    'Earnings': 'Earnings',
  }
  return labels[label] ?? label
}

function PassengerHome({ navigate, booking, subscription, routes, showPreviewData, passengerName }: {
  navigate: (section: string) => void
  booking: Booking | null
  subscription: SubscriptionSnapshot['subscription']
  routes: Route[]
  showPreviewData: boolean
  passengerName: string
}) {
  const subscriptionRoute = routes.find((route) => route.id === subscription?.routeId)
  const remaining = subscription
    ? getRemainingSchedule(subscription.serviceDates, subscription.direction, subscription.completedJourneyIds, localDateString())
    : null
  const hasJourney = Boolean(booking || subscription)

  return <div className="home-page">
    <section className="welcome-row"><div><p className="eyebrow">YOUR DAILY COMMUTE, SIMPLIFIED</p><h1>Hello, <span>{passengerName}!</span></h1><p className="muted">Where would you like to go today?</p></div><span className="today-date"><CalendarDays /> Ghana · Accra</span></section>
    {!hasJourney && <>
      <section className="home-hero"><div className="hero-copy"><span className="hero-tag"><i /> YOUR JOURNEY STARTS HERE</span><h2>Your seat.<br />Your journey.<br /><span>Your time.</span></h2><p>Skip the station stress.<br />Travel with confidence.</p></div><img src={heroVan} alt="SureSeat yellow Toyota Coaster commuter van" className="hero-van" /></section>
      <section className="home-booking-cta"><div><p className="eyebrow">LET'S GET YOU THERE</p><h2>Ready to book your ride?</h2><p className="muted">{showPreviewData ? 'Choose a route, pickup and destination to see available sample rides.' : 'Choose a route, pickup, and destination to see available rides.'}</p></div><button className="button button-primary" onClick={() => navigate('Booking')}>Start booking <ArrowRight /></button></section>
      <div className="panel upcoming-empty"><span className="empty-icon"><Ticket /></span><div><strong>No upcoming journeys</strong><p className="muted">Your next trip or subscription will appear here.</p></div><button className="text-button" onClick={() => navigate('My Trips')}>My trips <ArrowRight /></button></div>
    </>}
    {hasJourney && <section className="panel home-journey-card">
      <div className="section-heading"><div><p className="eyebrow">YOUR JOURNEY</p><h2>{booking ? booking.route : subscriptionRoute?.name ?? 'Current subscription'}</h2></div><span className="status-pill">{booking?.status ?? subscription?.status}</span></div>
      <div className="route-points"><span>{booking?.pickup ?? subscriptionRoute?.stops[subscription?.pickupIndex ?? 0]}</span><ArrowRight /><span>{booking?.dropoff ?? subscriptionRoute?.stops[subscription?.dropoffIndex ?? 0]}</span></div>
      {booking ? <div className="home-journey-details">
        <span><CalendarDays />{booking.date} · {booking.departure}</span>
        <span><UserRound />{booking.driver} · {booking.vehicle}</span>
        <strong>{formatGhs(booking.fare)}{showPreviewData ? ' · preview fare' : ''}</strong>
      </div> : subscription && <div className="home-journey-details">
        <span><CalendarDays />{formatPackageLabel(subscription.period)} · expires {subscription.endDate}</span>
        <span><Ticket />{remaining?.journeys ?? 0} journeys remaining · {subscription.direction}</span>
        <button className="text-button" onClick={() => navigate('My Subscription')}>Manage subscription <ArrowRight /></button>
      </div>}
      <div className="tracking-preview"><span className="tracking-preview-dot" /><span><strong>{showPreviewData ? 'Journey tracking preview' : 'Journey tracking'}</strong><small>Vehicle location is not connected yet.</small></span><button className="text-button" onClick={() => navigate('Live Tracking')}>Live Tracking <ArrowRight /></button></div>
    </section>}
    <div className="home-secondary-actions">
      <button className="button button-secondary" onClick={() => navigate('Booking')}>Book a ride</button>
      {!subscription && <button className="button button-secondary" onClick={() => navigate('My Subscription')}>View subscriptions</button>}
      {booking && <button className="button button-secondary" onClick={() => navigate('My Trips')}>View all trips</button>}
    </div>
  </div>
}

function ProfileScreen({ toast, authSnapshot }: { toast: (message: string) => void; authSnapshot: AuthSnapshot | null }) {
  const { submitIdentityVerification } = useAuth()
  const [identityDocument, setIdentityDocument] = useState<File | null>(null)
  const [identityUploadBusy, setIdentityUploadBusy] = useState(false)
  const [identityUploadError, setIdentityUploadError] = useState('')
  const [identityUploadMessage, setIdentityUploadMessage] = useState('')

  if (authSnapshot) {
    const deadline = new Date(authSnapshot.profile.verification_deadline_at)
    const restricted = isAccountRestricted(authSnapshot.profile)
    const verificationLabel = authSnapshot.profile.identity_verified_at
      ? 'Approved'
      : authSnapshot.identityVerificationStatus ?? 'Not submitted'
    const verificationPending = authSnapshot.identityVerificationStatus === 'pending'
    const verificationApproved = verificationLabel === 'Approved'

    async function submitDocument(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      if (!identityDocument) {
        setIdentityUploadError('Choose a JPG, PNG, or PDF document first.')
        return
      }
      setIdentityUploadBusy(true)
      setIdentityUploadError('')
      setIdentityUploadMessage('')
      try {
        await submitIdentityVerification(identityDocument)
        setIdentityDocument(null)
        setIdentityUploadMessage('Your document was submitted securely for manual review.')
      } catch (error) {
        setIdentityUploadError(getErrorMessage(error, 'Identity verification could not be submitted.'))
      } finally {
        setIdentityUploadBusy(false)
      }
    }

    return (
      <>
        <PageTitle eyebrow="PASSENGER · ACCOUNT" title="Profile & verification" detail="Review your account and identity verification status." />
        <section className="panel profile-form">
          <div className="profile-header">
            <span className="avatar avatar-large">{(authSnapshot.profile.full_name?.trim().charAt(0) || authSnapshot.user.email?.charAt(0) || 'S').toUpperCase()}</span>
            <div><h2>{authSnapshot.profile.full_name || 'Passenger account'}</h2><p className="muted">{authSnapshot.user.email}</p></div>
            <span className={`status-pill${restricted ? ' status-warning' : ''}`}>{restricted ? 'Restricted' : 'Account active'}</span>
          </div>
          <div className="profile-details">
            <div><small>PHONE NUMBER</small><strong>{authSnapshot.profile.phone || 'Not added'}</strong></div>
            <div><small>IDENTITY VERIFICATION</small><strong>{verificationLabel}</strong></div>
            <div><small>VERIFICATION DEADLINE</small><strong>{Number.isNaN(deadline.getTime()) ? 'Unavailable' : deadline.toLocaleString()}</strong></div>
            {authSnapshot.driverApplicationStatus && <div><small>DRIVER APPLICATION</small><strong>{authSnapshot.driverApplicationStatus}</strong></div>}
          </div>
          <div className="verification-note"><ShieldCheck /><span><strong>Ghana Card verification</strong><small>{restricted
            ? 'Your account is restricted until verification is approved. You can still sign in, check this status, and contact support.'
            : 'Identity documents are stored privately and reviewed by authorized SureSeat staff.'}</small></span></div>
          {identityUploadError && <p className="auth-feedback auth-error" role="alert">{identityUploadError}</p>}
          {identityUploadMessage && <p className="auth-feedback auth-success" role="status">{identityUploadMessage}</p>}
          {verificationPending
            ? <p className="auth-feedback auth-warning" role="status">Your identity document is pending manual review. You can continue using passenger features during the verification period.</p>
            : !verificationApproved && <form className="identity-upload-form" onSubmit={(event) => void submitDocument(event)}>
              <label className="field">Ghana Card document (JPG, PNG, or PDF; maximum 10 MB)
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(event) => setIdentityDocument(event.target.files?.[0] ?? null)}
                  disabled={identityUploadBusy}
                  required
                />
              </label>
              <button className="button button-primary" type="submit" disabled={identityUploadBusy || !identityDocument}>
                <FileCheck2 />{identityUploadBusy ? 'Uploading securely…' : 'Submit for verification'}
              </button>
            </form>}
          <button type="button" className="button button-secondary" onClick={() => toast('Contact SureSeat support if you need help with verification.')}>Contact support about verification</button>
        </section>
      </>
    )
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    toast('Profile changes saved in this preview session only.')
  }
  return <><PageTitle eyebrow="PASSENGER · ACCOUNT" title="Profile & verification" detail="Manage your personal information and identity verification." /><form className="panel profile-form" onSubmit={saveProfile}><div className="profile-header"><span className="avatar avatar-large">C</span><div><h2>Commuter Preview</h2><p className="muted">Passenger account · Preview</p></div><span className="status-pill">Verification pending</span></div><div className="form-grid"><label className="field">Full name<input defaultValue="Commuter Preview" required /></label><label className="field">Email address<input type="email" defaultValue="commuter@example.test" required /></label><label className="field">Phone number<input type="tel" defaultValue="+233 20 000 0000" required /></label><label className="field">Ghana Card number<input placeholder="Add Ghana Card number" /></label></div><div className="verification-note"><ShieldCheck /><span><strong>Identity verification</strong><small>Verification will securely connect when the new backend is ready. Do not upload sensitive documents in this preview.</small></span></div><button className="button button-primary">Save profile</button></form></>
}

function DriverProfile({ showPreviewData, authSnapshot }: { showPreviewData: boolean; authSnapshot: AuthSnapshot | null }) {
  if (!showPreviewData) {
    const name = authSnapshot?.profile.full_name || 'Driver account'
    const initial = name[0]?.toUpperCase() ?? 'D'
    return <><PageTitle eyebrow="DRIVER · ACCOUNT" title="Driver profile & vehicle" detail="Review your approved driver account and assigned vehicle." />
      <div className="panel profile-form"><div className="profile-header"><span className="avatar avatar-large">{initial}</span><div><h2>{name}</h2><p className="muted">{authSnapshot?.user.email ?? 'Email unavailable'}</p></div><span className="status-pill">{authSnapshot?.driverApplicationStatus ?? 'Status unavailable'}</span></div>
        <div className="profile-details"><div><small>DRIVER APPLICATION</small><strong>{authSnapshot?.driverApplicationStatus ?? 'Unavailable'}</strong></div><div><small>ACCOUNT STATUS</small><strong>{authSnapshot?.profile.account_status ?? 'Unavailable'}</strong></div></div>
        <p className="preview-note">Sensitive driver identity documents are available only in the authorized onboarding review workflow.</p>
      </div>
      <DriverAssignedVehicle />
    </>
  }
  return <><PageTitle eyebrow="DRIVER · ACCOUNT" title="Driver profile & vehicle" detail="Sample driver credentials and assigned vehicle information." /><div className="panel profile-form"><div className="profile-header"><span className="avatar avatar-large">K</span><div><h2>Kwame Mensah</h2><p className="muted">Driver · Account preview</p></div><span className="status-pill">Verified · Sample</span></div><div className="profile-details"><div><small>GHANA CARD</small><strong>•••• •••• 4821 · Sample verified</strong></div><div><small>DRIVER'S LICENCE</small><strong>DL-001-0000 · Sample verified</strong></div><div><small>VEHICLE REGISTRATION</small><strong>GR 4821-24 · Preview</strong></div><div><small>VEHICLE</small><strong>Toyota Coaster · 25 seats</strong></div><div><small>INSURANCE</small><strong>Sample expires 30 Dec</strong></div><div><small>DRIVER PHOTOGRAPH</small><strong>Sample record on file</strong></div></div><p className="preview-note">Sensitive identity and insurance documents are not collected or stored in this preview.</p></div></>
}

function SupportForm({ toast }: { toast: (message: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    toast('Your message was saved in preview. Support messaging is not connected.')
    event.currentTarget.reset()
  }
  return <form className="panel support-form" onSubmit={submit}><label className="field">What do you need help with?<select required defaultValue=""><option value="" disabled>Select a topic</option><option>Booking a ride</option><option>My trip</option><option>Payments</option><option>Account verification</option><option>Other</option></select></label><label className="field">Message<textarea required minLength={10} rows={5} placeholder="Tell us how we can help (at least 10 characters)" /></label><label className="field">Email for a reply<input type="email" required placeholder="you@example.com" /></label><button className="button button-primary"><Headphones />Send support request</button><p className="preview-note">Preview only: this form does not send personal information to a server.</p></form>
}

export default App
