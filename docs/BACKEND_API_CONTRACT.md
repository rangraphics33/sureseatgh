# SureSeat backend API contract (frontend proposal)

**Status:** Proposed for backend planning. This is not a live backend and does not imply that any endpoint exists.

## Conventions

- Configure the base URL with `VITE_API_BASE_URL`; do not hardcode deployment URLs.
- Use the `/v1` API prefix.
- Success JSON uses `{ "data": <payload>, "meta": { "requestId": "..." } }`.
- Errors use `{ "error": { "code": "...", "message": "...", "details": {} }, "requestId": "..." }`.
- List payloads use `{ "data": { "items": [], "page": 1, "pageSize": 20, "total": 0, "hasMore": false } }`.
- The frontend client also accepts bare JSON during contract transition. New endpoints should use the standard envelopes.
- Money is a decimal GHS amount at the API boundary. The backend validates and calculates every payable amount; never trust a fare or payment status supplied by the browser.
- Dates use `YYYY-MM-DD`; timestamps use ISO 8601 UTC.
- Retriable mutations (including booking creation, payment initiation, subscription purchase, and route changes) require an `Idempotency-Key` header.
- The proposed API client sends credentials for cookie-based sessions. If Supabase Auth is selected instead, agree access-token transport before implementation; do not casually mix the two approaches.

## Routes and fares

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/routes?status=published&page=&pageSize=` | Published routes and ordered stops with pricing |
| GET | `/v1/admin/routes?page=&pageSize=` | Admin route list, including drafts |
| POST | `/v1/admin/routes` | Create route |
| PATCH | `/v1/admin/routes/{routeId}` | Update route, stops, segment fares, or publication state |
| POST | `/v1/admin/routes/{routeId}/publish` | Validate fare reconciliation and publish |

A route includes `id`, `name`, `via`, ordered `stops`, `segmentFares`, `fullRouteFare`, `published`, and `updatedAt`. The server validates that each adjacent fare is non-negative and the segment total equals the full-route fare. Passenger fare is calculated from the selected adjacent segments by the server and returned as an authoritative quote.

## Ride search and bookings

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/rides?routeId=&travelDate=&departure=&pickupIndex=&dropoffIndex=&page=&pageSize=` | Search rides and authoritative fare/availability |
| POST | `/v1/bookings` | Atomically validate availability and create a booking hold |
| GET | `/v1/bookings?page=&pageSize=` | Current user's paginated bookings; admin scope is separately authorized |
| GET | `/v1/bookings/{bookingId}` | Booking details and current status |
| POST | `/v1/bookings/{bookingId}/confirm` | Confirm only after required payment verification |
| POST | `/v1/bookings/{bookingId}/cancel` | Cancel subject to server policy |

Booking creation accepts `routeId`, `travelDate`, `departure`, `pickupIndex`, `dropoffIndex`, and `rideId`. The idempotency key is sent only in the header, not as a fare or trusted client status. The server re-checks availability atomically to prevent overselling and calculates the fare.

A booking response includes `id`, `bookingCode`, `status`, `routeId`, `routeName`, `pickup`, `dropoff`, `travelDate`, `departure`, `rideId`, `vehicle`, `driver`, `totalFare`, and `createdAt`. Suggested statuses are `pending_payment`, `confirmed`, `cancelled`, `completed`, and `expired`. Booking holds need a server-defined expiry. Creating a hold is not confirmation or proof of payment.

## Payments and subscriptions

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/payments/initialize` | Start provider checkout for a booking or subscription |
| GET | `/v1/payments/{paymentId}` | Read server-verified payment status |
| POST | `/v1/payments/provider-webhook` | Provider webhook; server verifies signature and idempotently processes event |
| GET | `/v1/subscriptions/current` | Current user's server-owned subscription snapshot |
| POST | `/v1/subscriptions` | Purchase daily, weekly, monthly, or weekend package |
| POST | `/v1/subscriptions/{id}/route-change` | Quote and apply a route change after verified top-up |

The browser may initialize checkout and display provider status, but it must never mark a payment successful. A route upgrade is effective only after backend verification of the additional payment. If the passenger cannot pay, the original route and remaining schedule stay active; no debt, wallet credit, or negative balance is created. Do not infer a refund or credit rule for a cheaper route until policy is decided.

Transport booking checkout now targets Paystack test mode through Supabase Edge Functions. Each booking has one durable payment reference, retries reuse that reference, and only a server-side Paystack verification can confirm it. The webhook is signature checked and independently verifies the transaction. A payment that arrives after its seat hold expires is recorded for support/refund review and does not confirm the booking. Live Paystack credentials and deployment are not configured by this code change. Subscription payments remain unimplemented; simulated payment outcomes and subscription mutations are available only in preview mode and are disabled in API mode.

## Driver operations and tracking

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/driver/trips?page=&pageSize=` | Trips assigned to the authenticated driver |
| POST | `/v1/driver/trips/{tripId}/start` | Validate booking code and start trip |
| POST | `/v1/driver/trips/{tripId}/end-request` | Passenger requests trip end |
| POST | `/v1/driver/trips/{tripId}/complete` | Driver confirms completion |
| POST | `/v1/driver/location` | Authenticated driver location update |
| GET | `/v1/trips/{tripId}/location` | Authorized passenger/admin location read |

Only the assigned driver may start or complete a trip. Location permissions, update frequency, retention, and passenger visibility must be agreed before enabling tracking. Driver start/completion actions and tracking are not connected in the current frontend.

## Admin, audit, and reports

Admin endpoints must be role-guarded server-side and provide paginated/searchable lists for passengers, drivers, vehicles, bookings, payments, routes, and reports. Mutations such as driver approval, vehicle approval, fare changes, cancellations, and manual adjustments should record actor, timestamp, target, action, and before/after values in an audit log. Avoid exposing Ghana Card or licence document URLs in general list responses.

Admin sample records and dashboard metrics in the frontend remain illustrative; they are not API data.

## Pagination, concurrency, and errors

- Lists use `page` and `pageSize`; the server caps page size.
- Use `409 CONFLICT` for stale/conflicting updates and unavailable capacity, with a stable error code and safe message.
- Use `422 VALIDATION_ERROR` with field-level `details` for invalid input.
- Use `401 UNAUTHENTICATED` for expired/missing sessions and `403 FORBIDDEN` for insufficient role.
- Use `429 RATE_LIMITED` for throttling.
- Mutations may use an `If-Match`/version field for concurrent admin edits.

## Environment and deployment

- Local development uses `.env.local` with `VITE_DATA_MODE=preview` until the API is available.
- API mode uses `VITE_DATA_MODE=api` and `VITE_API_BASE_URL` for the agreed staging API.
- Production uses a separate production API URL. Never commit secrets; `VITE_` variables are public and must not contain service-role keys, payment secrets, or private credentials.
- Configure SPA fallback to serve `index.html` for client-side routes, exact backend CORS origins, and HTTPS outside local development.
- API mode never falls back to sample data if configuration or a request fails.

## Decisions required before backend implementation

1. Confirm Supabase Auth versus a custom cookie/session API. No authentication is implemented by this frontend preparation.
2. Confirm booking hold duration and cancellation/refund rules.
3. Confirm whether the payment provider is Paystack, MTN MoMo, or a combined checkout abstraction.
4. Confirm monthly eligible weekday calculation and weekend package date-selection rules.
5. Confirm cheaper-route change treatment; no refund or wallet credit is assumed.
6. Confirm GPS update frequency, retention, and trip visibility permissions.
