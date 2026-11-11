import assert from 'node:assert/strict'
import test from 'node:test'
import { initialRoutes } from '../src/data/routes.ts'
import { matchesDepartureWindow } from '../src/utils/departure.ts'
import { ApiError } from '../src/services/apiClient.ts'
import { previewPlatformService, selectPlatformService } from '../src/services/platform.ts'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('service selection defaults to fully usable preview data and filters rides by route and departure', async () => {
  const selection = selectPlatformService(undefined, undefined)
  assert.equal(selection.isPreviewMode, true)
  assert.equal(selection.configurationError, null)
  assert.equal(selection.service, previewPlatformService)

  const morningRides = await selection.service.getRides({
    routeId: 'nungua-circle-beach-road',
    travelDate: '2999-01-01',
    departure: 'Morning',
    pickupIndex: 0,
    dropoffIndex: 1,
  })
  const eveningRides = await selection.service.getRides({
    routeId: 'tema-circle-beach-road',
    travelDate: '2999-01-01',
    departure: 'Evening',
    pickupIndex: 0,
    dropoffIndex: 1,
  })

  assert.deepEqual(morningRides.map((ride) => ride.id), ['ride-morning-1', 'ride-morning-2'])
  assert.deepEqual(eveningRides.map((ride) => ride.id), ['ride-evening-1'])
})

test('departure windows recognize display labels, meridiem casing, and 24-hour API times', () => {
  for (const departure of ['6:30 AM', '6:30 am', '00:15', '11:59:00']) {
    assert.equal(matchesDepartureWindow(departure, 'Morning'), true, departure)
    assert.equal(matchesDepartureWindow(departure, 'Evening'), false, departure)
  }
  for (const departure of ['5:30 PM', '5:30 pm', '12:00', '17:30:00', '23:59']) {
    assert.equal(matchesDepartureWindow(departure, 'Evening'), true, departure)
    assert.equal(matchesDepartureWindow(departure, 'Morning'), false, departure)
  }
  assert.equal(matchesDepartureWindow('Evening service', 'Evening'), true)
  assert.equal(matchesDepartureWindow('not a time', 'Morning'), false)
})

test('service selection reports invalid modes and missing API URLs without falling back to preview', async () => {
  for (const selection of [
    selectPlatformService('api', undefined),
    selectPlatformService('production', 'https://api.example.test'),
  ]) {
    assert.equal(selection.isPreviewMode, false)
    assert.ok(selection.configurationError)
    await assert.rejects(selection.service.getRoutes(), ApiError)
  }
})

test('API mode reads all route pages from the standard envelope', async () => {
  const urls = []
  const selection = selectPlatformService('api', 'https://api.example.test/', async (input) => {
    urls.push(String(input))
    const page = new URL(String(input)).searchParams.get('page')
    const items = page === '1' ? [initialRoutes[0]] : [initialRoutes[1]]
    return jsonResponse({
      data: { items, page: Number(page), pageSize: 1, total: 2, hasMore: page === '1' },
    })
  })

  assert.equal(selection.isPreviewMode, false)
  assert.equal(selection.configurationError, null)
  assert.deepEqual(await selection.service.getRoutes(), initialRoutes)
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get('page')), ['1', '2'])
  assert.ok(urls[0].includes('status=published'))
})

test('API mode reports request failures and never returns preview routes', async () => {
  const selection = selectPlatformService('api', 'https://api.example.test', async () => {
    throw new TypeError('offline')
  })

  await assert.rejects(selection.service.getRoutes(), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'NETWORK_ERROR')
    return true
  })
})

test('API mode sends booking idempotency in the header without trusting client fare', async () => {
  let requestBody
  let idempotencyKey
  const selection = selectPlatformService('api', 'https://api.example.test', async (_input, init) => {
    requestBody = JSON.parse(String(init.body))
    idempotencyKey = new Headers(init.headers).get('Idempotency-Key')
    return jsonResponse({ data: { id: 'booking-1', bookingCode: 'SS-001', status: 'pending_payment' } })
  })
  const { service } = selection

  await service.createBooking({
    idempotencyKey: 'attempt-1',
    routeId: 'nungua-circle-beach-road',
    travelDate: '2999-01-01',
    departure: 'Morning',
    pickupIndex: 0,
    dropoffIndex: 1,
    rideId: 'ride-morning-1',
  })

  assert.equal(idempotencyKey, 'attempt-1')
  assert.equal('totalFare' in requestBody, false)
  assert.equal(requestBody.routeId, 'nungua-circle-beach-road')
})

test('preview booking holds remain pending, unpaid, and idempotent', async () => {
  const request = {
    idempotencyKey: `preview-test-${crypto.randomUUID()}`,
    routeId: 'nungua-circle-beach-road',
    travelDate: '2999-01-01',
    departure: 'Morning',
    pickupIndex: 0,
    dropoffIndex: 1,
    rideId: 'ride-morning-1',
  }
  const first = await previewPlatformService.createBooking(request)
  const repeated = await previewPlatformService.createBooking(request)

  assert.equal(first.status, 'pending_payment')
  assert.equal(first.totalFare, 1)
  assert.equal(first.id, repeated.id)
  assert.notEqual(first.status, 'confirmed')
})

test('API mode cannot simulate payment success', async () => {
  const { service } = selectPlatformService('api', 'https://api.example.test')
  await assert.rejects(service.simulatePayment({
    idempotencyKey: 'payment-preview',
    amount: 10,
    outcome: 'succeeded',
  }), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'FORBIDDEN')
    return true
  })
})
