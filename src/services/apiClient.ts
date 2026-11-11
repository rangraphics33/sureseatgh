export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: unknown
  readonly requestId?: string

  constructor(
    message: string,
    options: { code?: ApiErrorCode; status?: number; details?: unknown; requestId?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = options.code ?? 'UNKNOWN_ERROR'
    this.status = options.status ?? 0
    this.details = options.details
    this.requestId = options.requestId
  }
}

type ApiEnvelope<T> = { data: T; meta?: { requestId?: string } }
type ApiErrorBody = { error?: { code?: string; message?: string; details?: unknown }; message?: string; requestId?: string }

const errorCodes = new Set<ApiErrorCode>([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'UNKNOWN_ERROR',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return isRecord(value)
}

function mapErrorCode(status: number, code: unknown): ApiErrorCode {
  if (typeof code === 'string' && errorCodes.has(code as ApiErrorCode)) return code as ApiErrorCode
  if (status === 400 || status === 422) return 'VALIDATION_ERROR'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER_ERROR'
  return 'UNKNOWN_ERROR'
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    const trimmed = baseUrl.trim()
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      throw new TypeError('VITE_API_BASE_URL must be an absolute HTTP or HTTPS URL.')
    }
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password
      || parsed.search || parsed.hash) {
      throw new TypeError('VITE_API_BASE_URL must be an absolute HTTP or HTTPS URL without credentials, query, or hash.')
    }
    this.baseUrl = trimmed.replace(/\/+$/, '')
    this.fetcher = fetcher
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json')
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        ...options,
        headers,
        credentials: 'include',
      })
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : 'Unable to reach the server.', {
        code: 'NETWORK_ERROR',
      })
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : 'The response could not be read.', {
        code: 'NETWORK_ERROR',
        status: response.status,
      })
    }

    let body: unknown = null
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown
      } catch {
        if (response.ok) {
          throw new ApiError('The server returned an invalid JSON response.', {
            code: 'UNKNOWN_ERROR',
            status: response.status,
          })
        }
      }
    }

    if (!response.ok) {
      const errorBody = isApiErrorBody(body) ? body : null
      const nestedError = errorBody && isRecord(errorBody.error) ? errorBody.error : null
      throw new ApiError(
        getString(nestedError?.message) ?? getString(errorBody?.message) ?? `Request failed (${response.status}).`,
        {
          code: mapErrorCode(response.status, nestedError?.code),
          status: response.status,
          details: nestedError?.details,
          requestId: getString(errorBody?.requestId),
        },
      )
    }

    if (body === null) {
      throw new ApiError('The server returned an empty response where JSON data was expected.', {
        code: 'UNKNOWN_ERROR',
        status: response.status,
      })
    }

    if (isRecord(body) && 'data' in body) return (body as ApiEnvelope<T>).data
    return body as T
  }
}
