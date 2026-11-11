import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addRouteStop,
  applyPaidRouteChange,
  getJourneyFare,
  getRemainingSchedule,
  getRenewalStartDate,
  isScheduledRenewalDue,
  getRouteChangeCosts,
  getRoutePricingStatus,
  getSubscriptionQuote,
  getSubscriptionSchedule,
  removeRouteStop,
  reorderRouteStop,
} from '../src/utils/pricing.ts'
import { initialRoutes } from '../src/data/routes.ts'

const route = {
  id: 'sample',
  name: 'Point A → Point E',
  via: 'Sample',
  stops: ['Point A', 'Point B', 'Point C', 'Point D', 'Point E'],
  segmentFares: [6, 3, 3, 3],
  fullRouteFare: 15,
  published: true,
}

test('configured sample routes have a fare for every adjacent pair and a reconciled target', () => {
  for (const sampleRoute of initialRoutes) {
    assert.equal(sampleRoute.segmentFares?.length, sampleRoute.stops.length - 1)
    assert.equal(getRoutePricingStatus(sampleRoute).valid, true)
  }
})

test('segment fares sum only the adjacent journey segments', () => {
  assert.equal(getJourneyFare(route, 0, 4), 15)
  assert.equal(getJourneyFare(route, 1, 3), 6)
  assert.equal(getJourneyFare(route, 2, 2), null)
  assert.equal(getJourneyFare(route, -1, 2), null)
  assert.equal(getJourneyFare({ ...route, segmentFares: [6, null, 3, 3] }, 0, 3), null)
})

test('route pricing requires one valid fare per adjacent stop and a matching full fare', () => {
  assert.equal(getRoutePricingStatus(route).valid, true)
  assert.equal(getRoutePricingStatus({ ...route, fullRouteFare: 16 }).valid, false)
  assert.equal(getRoutePricingStatus({ ...route, segmentFares: [6, 3, 3] }).valid, false)
  assert.equal(getRoutePricingStatus({ ...route, segmentFares: [6, -1, 3, 7] }).valid, false)
  assert.equal(getRoutePricingStatus({ ...route, segmentFares: [6.001, 3, 3, 3] }).valid, false)
  assert.equal(getRoutePricingStatus({ ...route, fullRouteFare: null }).valid, false)
})

test('daily, weekly and monthly package quotes use the configured journey frequency', () => {
  const base = { route, pickupIndex: 1, dropoffIndex: 3, startDate: '2026-11-11', today: '2026-11-09' }
  assert.equal(getSubscriptionQuote({ ...base, period: 'daily', direction: 'morning' }).journeys, 1)
  assert.equal(getSubscriptionQuote({ ...base, period: 'daily', direction: 'evening' }).journeys, 1)
  assert.equal(getSubscriptionQuote({ ...base, period: 'daily', direction: 'both' }).journeys, 2)

  const weekly = getSubscriptionQuote({ ...base, period: 'weekly', direction: 'both' })
  assert.equal(weekly.eligibleDays, 5)
  assert.equal(weekly.journeys, 10)
  assert.deepEqual(weekly.serviceDates, ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'])
  assert.equal(weekly.baseTotal, 60)
  assert.equal(weekly.total, 60)

  const monthly = getSubscriptionQuote({ ...base, period: 'monthly', direction: 'evening' })
  assert.equal(monthly.eligibleDays, monthly.journeys)
  assert.equal(monthly.total, monthly.journeys * 6)
})

test('monthly period end clamps month-end and leap-year anniversaries', () => {
  assert.equal(getSubscriptionSchedule('monthly', '2023-01-31', [], '2023-01-01').endDate, '2023-02-27')
  assert.equal(getSubscriptionSchedule('monthly', '2024-01-31', [], '2024-01-01').endDate, '2024-02-28')
  assert.equal(getSubscriptionSchedule('monthly', '2024-02-29', [], '2024-02-01').endDate, '2024-03-28')
})

test('renewal starts the day after an unexpired package and today after expiry', () => {
  assert.equal(getRenewalStartDate('2026-11-20', '2026-11-09'), '2026-11-21')
  assert.equal(getRenewalStartDate('2026-11-09', '2026-11-09'), '2026-11-10')
  assert.equal(getRenewalStartDate('2026-11-08', '2026-11-09'), '2026-11-09')
  assert.equal(getRenewalStartDate('invalid', '2026-11-09'), '2026-11-09')
})

test('scheduled renewal becomes active only after the current end date and at its start date', () => {
  assert.equal(isScheduledRenewalDue('2026-11-20', '2026-11-21', '2026-11-20'), false)
  assert.equal(isScheduledRenewalDue('2026-11-20', '2026-11-21', '2026-11-21'), true)
  assert.equal(isScheduledRenewalDue('2026-11-20', '2026-11-23', '2026-11-22'), false)
  assert.equal(isScheduledRenewalDue('invalid', '2026-11-21', '2026-11-21'), false)
})

test('weekly schedules starting on weekends begin on the next eligible weekday', () => {
  const schedule = getSubscriptionSchedule('weekly', '2026-11-14', [], '2026-11-09')
  assert.deepEqual(schedule.serviceDates, ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'])
})

test('weekend package dates reject weekdays, duplicates and past selections', () => {
  assert.equal(getSubscriptionSchedule('weekend', '2026-11-09', ['2026-11-14', '2026-11-15'], '2026-11-09').valid, true)
  assert.equal(getSubscriptionSchedule('weekend', '2026-11-09', ['2026-11-13'], '2026-11-09').valid, false)
  assert.equal(getSubscriptionSchedule('weekend', '2026-11-09', ['2026-11-14', '2026-11-14'], '2026-11-09').valid, false)
  assert.equal(getSubscriptionSchedule('weekend', '2026-11-09', ['2026-11-07'], '2026-11-09').valid, false)
  assert.equal(getSubscriptionSchedule('weekend', '2026-11-16', ['2026-11-14'], '2026-11-09').valid, false)
  assert.equal(getSubscriptionSchedule('weekend', '2026-11-16', ['2026-11-21'], '2026-11-09').valid, true)
  assert.equal(getSubscriptionQuote({ route, pickupIndex: 0, dropoffIndex: 1, period: 'weekend', direction: 'both', startDate: '2026-11-09', weekendDates: ['2026-11-14'], today: '2026-11-09' }).journeys, 2)
})

test('remaining service schedule excludes passed and completed journeys', () => {
  const remaining = getRemainingSchedule(
    ['2026-11-08', '2026-11-09', '2026-11-10'],
    'both',
    ['2026-11-09:morning'],
    '2026-11-09',
  )
  assert.deepEqual(remaining.journeyIds, ['2026-11-09:evening', '2026-11-10:morning', '2026-11-10:evening'])
  assert.equal(remaining.serviceDays, 2)
  assert.equal(remaining.journeys, 3)
})

test('route-change due compares only remaining journey costs and never creates a credit', () => {
  const remaining = { journeyIds: ['one', 'two', 'three'], serviceDays: 2, journeys: 3 }
  assert.deepEqual(getRouteChangeCosts(6, 9, remaining), {
    originalRemainingCost: 18,
    revisedRemainingCost: 27,
    additionalPayment: 9,
  })
  assert.equal(getRouteChangeCosts(9, 6, remaining).additionalPayment, 0)
})

test('failed, cancelled, pending, mismatched and duplicate payments leave the subscription unchanged', () => {
  const current = { routeId: 'old', pickupIndex: 1, dropoffIndex: 3, totalPaid: 60 }
  const proposal = { routeId: 'new', pickupIndex: 2, dropoffIndex: 4, additionalPayment: 9 }
  for (const status of ['failed', 'cancelled', 'pending']) {
    const result = applyPaidRouteChange(current, proposal, { paymentId: status, amount: 9, status }, new Set())
    assert.equal(result.applied, false)
    assert.equal(result.subscription, current)
  }
  assert.equal(applyPaidRouteChange(current, proposal, { paymentId: 'mismatch', amount: 8, status: 'succeeded' }, new Set()).subscription, current)
  assert.equal(applyPaidRouteChange(current, proposal, { paymentId: 'duplicate', amount: 9, status: 'succeeded' }, new Set(['duplicate'])).subscription, current)
})

test('a verified payment applies a route change once and adds only the due amount', () => {
  const current = { routeId: 'old', pickupIndex: 1, dropoffIndex: 3, totalPaid: 60 }
  const proposal = { routeId: 'new', pickupIndex: 2, dropoffIndex: 4, additionalPayment: 9 }
  const result = applyPaidRouteChange(current, proposal, { paymentId: 'paid-1', amount: 9, status: 'succeeded' }, new Set())
  assert.equal(result.applied, true)
  assert.deepEqual(result.subscription, { routeId: 'new', pickupIndex: 2, dropoffIndex: 4, totalPaid: 69 })
})

test('adding, removing and reordering stops preserve or invalidate the correct segment fares', () => {
  const base = { ...route, stops: ['A', 'B', 'C', 'D'], segmentFares: [2, 3, 4] }
  assert.deepEqual(addRouteStop(base, 'E').segmentFares, [2, 3, 4, null])
  assert.deepEqual(removeRouteStop(base, 1).segmentFares, [null, 4])
  assert.deepEqual(removeRouteStop(base, 0).segmentFares, [3, 4])
  assert.deepEqual(removeRouteStop(base, 3).segmentFares, [2, 3])
  const reordered = reorderRouteStop(base, 1, 1)
  assert.deepEqual(reordered.stops, ['A', 'C', 'B', 'D'])
  assert.deepEqual(reordered.segmentFares, [null, null, null])
  assert.equal(reordered.published, false)
})
