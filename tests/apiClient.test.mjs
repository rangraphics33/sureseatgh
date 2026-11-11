import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiClient, ApiError } from '../src/services/apiClient.ts'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('ApiClient unwraps the proposed success envelope and sends credentialed JSON requests', async () => {
  let requestUrl = ''
  let requestInit
  const client = new ApiClient('https://api.example.test/', async (input, init) => {
    requestUrl = String(input)
    requestInit = init
    return jsonResponse({ data: { id: 'route-1' }, meta: { requestId: 'req-1' } })
  })

  const result = await client.request('/v1/routes')

  assert.deepEqual(result, { id: 'route-1' })
  assert.equal(requestUrl, 'https://api.example.test/v1/routes')
  assert.equal(requestInit.credentials, 'include')
  assert.equal(new Headers(requestInit.headers).get('Accept'), 'application/json')
})

test('ApiClient accepts bare JSON during contract transition', async () => {
  const client = new ApiClient('https://api.example.test', async () => jsonResponse([{ id: 'route-1' }]))
  assert.deepEqual(await client.request('/v1/routes'), [{ id: 'route-1' }])
})

test('ApiClient normalizes contract errors and preserves safe details and request id', async () => {
  const client = new ApiClient('https://api.example.test', async () => jsonResponse({
    error: { code: 'VALIDATION_ERROR', message: 'Invalid route.', details: { routeId: 'Required' } },
    requestId: 'req-422',
  }, 422))

  await assert.rejects(client.request('/v1/bookings'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'VALIDATION_ERROR')
    assert.equal(error.status, 422)
    assert.equal(error.message, 'Invalid route.')
    assert.deepEqual(error.details, { routeId: 'Required' })
    assert.equal(error.requestId, 'req-422')
    return true
  })
})

test('ApiClient maps status-only errors when the server body is not JSON', async () => {
  const client = new ApiClient('https://api.example.test', async () => new Response('unavailable', { status: 503 }))
  await assert.rejects(client.request('/v1/routes'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'SERVER_ERROR')
    assert.equal(error.status, 503)
    return true
  })
})

test('ApiClient reports network failures explicitly', async () => {
  const client = new ApiClient('https://api.example.test', async () => {
    throw new TypeError('Network unavailable')
  })
  await assert.rejects(client.request('/v1/routes'), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'NETWORK_ERROR')
    assert.match(error.message, /Network unavailable/)
    return true
  })
})

test('ApiClient rejects empty and malformed successful responses', async () => {
  const emptyClient = new ApiClient('https://api.example.test', async () => new Response(null, { status: 204 }))
  const malformedClient = new ApiClient('https://api.example.test', async () => new Response('{bad json'))

  await assert.rejects(emptyClient.request('/v1/routes'), { code: 'UNKNOWN_ERROR' })
  await assert.rejects(malformedClient.request('/v1/routes'), /invalid JSON/i)
})

test('ApiClient rejects an invalid or secret-bearing base URL', () => {
  assert.throws(() => new ApiClient('not a URL'), /absolute HTTP or HTTPS URL/)
  assert.throws(() => new ApiClient('https://user:password@api.example.test'), /without credentials/)
})
