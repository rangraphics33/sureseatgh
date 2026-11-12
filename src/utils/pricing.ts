import type { Route } from '../data/routes'

export type SubscriptionPeriod = 'daily' | 'weekly' | 'monthly' | 'weekend'
export type TravelDirection = 'morning' | 'evening' | 'both'
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled'

export interface RoutePricingStatus {
  valid: boolean
  standardFare: number | null
  message: string
}

export interface SubscriptionSchedule {
  valid: boolean
  error: string | null
  startDate: string
  endDate: string
  serviceDates: string[]
}

export interface SubscriptionQuoteInput {
  route: Route
  pickupIndex: number
  dropoffIndex: number
  period: SubscriptionPeriod
  direction: TravelDirection
  startDate: string
  weekendDates?: string[]
  today?: string
}

export interface SubscriptionQuote extends SubscriptionSchedule {
  journeyFare: number | null
  journeys: number
  baseTotal: number
  discount: number
  total: number
  eligibleDays: number
}

export interface RemainingSchedule {
  journeyIds: string[]
  serviceDays: number
  journeys: number
}

export interface PaidRouteChangeState {
  routeId: string
  pickupIndex: number
  dropoffIndex: number
  totalPaid: number
}

export interface PaidRouteChangeProposal {
  routeId: string
  pickupIndex: number
  dropoffIndex: number
  additionalPayment: number
}

export interface PaymentReceipt {
  paymentId: string
  amount: number
  status: PaymentStatus
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isCurrencyValue(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
}

export function getRoutePricingStatus(route: Route): RoutePricingStatus {
  const standardFare = route.standardFare
  const fareIsValid = isCurrencyValue(standardFare) && standardFare > 0
  const valid = route.stops.length >= 2 && fareIsValid
  return {
    valid,
    standardFare: fareIsValid ? standardFare : null,
    message: route.stops.length < 2
      ? 'Add at least two stops.'
      : fareIsValid ? 'Standard route fare is set.' : 'Set a standard route fare greater than zero.',
  }
}

export function getJourneyFare(route: Route, pickupIndex: number, dropoffIndex: number): number | null {
  if (!getRoutePricingStatus(route).valid
    || !Number.isInteger(pickupIndex)
    || !Number.isInteger(dropoffIndex)
    || pickupIndex < 0
    || dropoffIndex <= pickupIndex
    || dropoffIndex >= route.stops.length) return null

  return route.standardFare ?? null
}

export function formatGhs(value: number) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null
}

export function formatIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function getRenewalStartDate(currentEndDate: string, today: string): string {
  const endDate = parseIsoDate(currentEndDate)
  const todayDate = parseIsoDate(today)
  if (!endDate || !todayDate || endDate < todayDate) return today
  const nextDay = new Date(endDate)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  return formatIsoDate(nextDay)
}

export function isScheduledRenewalDue(currentEndDate: string, renewalStartDate: string, today: string): boolean {
  const endDate = parseIsoDate(currentEndDate)
  const startDate = parseIsoDate(renewalStartDate)
  const todayDate = parseIsoDate(today)
  return !!endDate && !!startDate && !!todayDate && endDate < todayDate && startDate <= todayDate
}

function addUtcDays(date: Date, count: number) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + count)
  return result
}

function isWeekday(date: Date) {
  const day = date.getUTCDay()
  return day >= 1 && day <= 5
}

function monthEndFor(start: Date) {
  const nextMonthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const finalDay = new Date(Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth() + 1, 0)).getUTCDate()
  const anniversary = new Date(Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth(), Math.min(start.getUTCDate(), finalDay)))
  return addUtcDays(anniversary, -1)
}

export function getSubscriptionSchedule(
  period: SubscriptionPeriod,
  startDate: string,
  weekendDates: string[] = [],
  today = formatIsoDate(new Date()),
): SubscriptionSchedule {
  const start = parseIsoDate(startDate)
  const todayDate = parseIsoDate(today)
  if (!start || !todayDate) {
    return { valid: false, error: 'Choose a valid start date.', startDate, endDate: startDate, serviceDates: [] }
  }
  if (start < todayDate) {
    return { valid: false, error: 'The start date cannot be in the past.', startDate, endDate: startDate, serviceDates: [] }
  }

  if (period === 'weekend') {
    const uniqueDates = [...new Set(weekendDates)]
    if (uniqueDates.length !== weekendDates.length) {
      return { valid: false, error: 'Remove duplicate weekend dates.', startDate, endDate: startDate, serviceDates: [] }
    }
    const parsedDates = uniqueDates.map((value) => ({ value, date: parseIsoDate(value) }))
    if (parsedDates.some(({ value, date }) => !date || date < todayDate || value < startDate || date.getUTCDay() % 6 !== 0)) {
      return { valid: false, error: 'Choose future Saturdays and Sundays on or after the package start date.', startDate, endDate: startDate, serviceDates: [] }
    }
    const serviceDates = parsedDates.map(({ value }) => value).sort()
    if (!serviceDates.length) {
      return { valid: false, error: 'Select at least one weekend date.', startDate, endDate: startDate, serviceDates: [] }
    }
    return { valid: true, error: null, startDate: serviceDates[0], endDate: serviceDates[serviceDates.length - 1], serviceDates }
  }

  if (period === 'daily') {
    return { valid: true, error: null, startDate, endDate: startDate, serviceDates: [startDate] }
  }

  if (period === 'weekly') {
    const serviceDates: string[] = []
    let cursor = start
    while (serviceDates.length < 5) {
      if (isWeekday(cursor)) serviceDates.push(formatIsoDate(cursor))
      if (serviceDates.length < 5) cursor = addUtcDays(cursor, 1)
    }
    return { valid: true, error: null, startDate, endDate: serviceDates[serviceDates.length - 1], serviceDates }
  }

  const end = monthEndFor(start)
  const serviceDates: string[] = []
  for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, 1)) {
    if (isWeekday(cursor)) serviceDates.push(formatIsoDate(cursor))
  }
  return { valid: serviceDates.length > 0, error: serviceDates.length ? null : 'This monthly period has no eligible weekdays.', startDate, endDate: formatIsoDate(end), serviceDates }
}

export function getSubscriptionQuote(input: SubscriptionQuoteInput): SubscriptionQuote {
  const schedule = getSubscriptionSchedule(input.period, input.startDate, input.weekendDates, input.today)
  const journeyFare = getJourneyFare(input.route, input.pickupIndex, input.dropoffIndex)
  const journeysPerDay = input.direction === 'both' ? 2 : 1
  const journeys = schedule.serviceDates.length * journeysPerDay
  const baseTotal = journeyFare === null ? 0 : roundMoney(journeyFare * journeys)
  const valid = schedule.valid && journeyFare !== null && journeys > 0

  return {
    ...schedule,
    valid,
    error: schedule.error ?? (journeyFare === null ? 'Choose a route with a standard fare and a destination after pickup.' : null),
    journeyFare,
    journeys,
    baseTotal,
    discount: 0,
    total: baseTotal,
    eligibleDays: schedule.serviceDates.length,
  }
}

export function getRemainingSchedule(
  serviceDates: string[],
  direction: TravelDirection,
  completedJourneyIds: string[],
  today = formatIsoDate(new Date()),
): RemainingSchedule {
  const dates = serviceDates.filter((date) => parseIsoDate(date) && date >= today)
  const directions = direction === 'both' ? ['morning', 'evening'] : [direction]
  const completed = new Set(completedJourneyIds)
  const journeyIds = dates.flatMap((date) => directions.map((time) => `${date}:${time}`)).filter((id) => !completed.has(id))
  return {
    journeyIds,
    serviceDays: new Set(journeyIds.map((id) => id.slice(0, 10))).size,
    journeys: journeyIds.length,
  }
}

export function getRouteChangeAmount(originalRemainingCost: number, revisedRemainingCost: number) {
  if (!Number.isFinite(originalRemainingCost) || !Number.isFinite(revisedRemainingCost)) return 0
  return roundMoney(Math.max(0, revisedRemainingCost - originalRemainingCost))
}

export function applyPaidRouteChange<T extends PaidRouteChangeState>(
  current: T,
  proposal: PaidRouteChangeProposal,
  receipt: PaymentReceipt,
  appliedPaymentIds: ReadonlySet<string>,
): { subscription: T; applied: boolean; reason: string | null } {
  if (receipt.status !== 'succeeded') {
    return { subscription: current, applied: false, reason: `Payment ${receipt.status}; the current route remains active.` }
  }
  if (!receipt.paymentId || appliedPaymentIds.has(receipt.paymentId)) {
    return { subscription: current, applied: false, reason: 'Payment confirmation is missing or has already been applied.' }
  }
  if (!isCurrencyValue(proposal.additionalPayment)
    || proposal.additionalPayment <= 0
    || !isCurrencyValue(receipt.amount)
    || receipt.amount !== proposal.additionalPayment) {
    return { subscription: current, applied: false, reason: 'The confirmed amount does not match the route-change amount.' }
  }

  return {
    subscription: {
      ...current,
      routeId: proposal.routeId,
      pickupIndex: proposal.pickupIndex,
      dropoffIndex: proposal.dropoffIndex,
      totalPaid: roundMoney(current.totalPaid + receipt.amount),
    },
    applied: true,
    reason: null,
  }
}

export function addRouteStop(route: Route, stop: string): Route {
  return {
    ...route,
    stops: [...route.stops, stop],
    published: false,
  }
}

export function removeRouteStop(route: Route, stopIndex: number): Route {
  if (!Number.isInteger(stopIndex) || stopIndex < 0 || stopIndex >= route.stops.length) {
    throw new RangeError('Stop index is outside the route.')
  }
  const stops = route.stops.filter((_, index) => index !== stopIndex)
  return { ...route, stops, published: false }
}

export function reorderRouteStop(route: Route, stopIndex: number, direction: -1 | 1): Route {
  const nextIndex = stopIndex + direction
  if (!Number.isInteger(stopIndex) || stopIndex < 0 || stopIndex >= route.stops.length
    || nextIndex < 0 || nextIndex >= route.stops.length) {
    throw new RangeError('Stop reorder is outside the route.')
  }
  const stops = [...route.stops]
  ;[stops[stopIndex], stops[nextIndex]] = [stops[nextIndex], stops[stopIndex]]
  return {
    ...route,
    stops,
    published: false,
  }
}

export function getRouteChangeCosts(
  originalFare: number | null,
  revisedFare: number | null,
  remaining: RemainingSchedule,
) {
  if (originalFare === null || revisedFare === null || remaining.journeys === 0) return null
  const originalRemainingCost = roundMoney(originalFare * remaining.journeys)
  const revisedRemainingCost = roundMoney(revisedFare * remaining.journeys)
  return {
    originalRemainingCost,
    revisedRemainingCost,
    additionalPayment: getRouteChangeAmount(originalRemainingCost, revisedRemainingCost),
  }
}
