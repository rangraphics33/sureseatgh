import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, CheckCircle2, CreditCard, MapPin, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { Route } from '../../data/routes'
import { isPreviewMode, platformService } from '../../services/platform'
import {
  applyPaidRouteChange,
  formatGhs,
  getRenewalStartDate,
  getJourneyFare,
  getRemainingSchedule,
  getRouteChangeCosts,
  getRoutePricingStatus,
  getSubscriptionQuote,
  isScheduledRenewalDue,
  parseIsoDate,
  type PaymentStatus,
  type SubscriptionPeriod,
  type TravelDirection,
} from '../../utils/pricing'

export interface ActiveSubscription {
  id: string
  routeId: string
  pickupIndex: number
  dropoffIndex: number
  period: SubscriptionPeriod
  direction: TravelDirection
  startDate: string
  endDate: string
  serviceDates: string[]
  weekendDates: string[]
  totalPaid: number
  completedJourneyIds: string[]
  status: string
}

export interface SubscriptionPayment {
  id: string
  date: string
  description: string
  amount: number
  status: PaymentStatus
}

export interface SubscriptionSnapshot {
  subscription: ActiveSubscription | null
  renewal: ActiveSubscription | null
  payments: SubscriptionPayment[]
}

type Props = {
  routes: Route[]
  initialSnapshot: SubscriptionSnapshot
  onSnapshotChange: (snapshot: SubscriptionSnapshot) => void
  onToast: (message: string) => void
  allowChanges?: boolean
}

type PendingRouteChange = {
  idempotencyKey: string
  subscriptionId: string
  routeId: string
  pickupIndex: number
  dropoffIndex: number
  amount: number
}

function localDateString() {
  const date = new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function formatPackage(period: SubscriptionPeriod) {
  return period[0].toUpperCase() + period.slice(1)
}

function formatDirection(direction: TravelDirection) {
  return direction === 'both' ? 'Morning + Evening' : `${direction[0].toUpperCase()}${direction.slice(1)} only`
}

function isPaymentStatus(value: string): value is PaymentStatus {
  return value === 'pending' || value === 'succeeded' || value === 'failed' || value === 'cancelled'
}

export default function SubscriptionScreen({ routes, initialSnapshot, onSnapshotChange, onToast, allowChanges = true }: Props) {
  const availableRoutes = useMemo(
    () => routes.filter((route) => route.published && getRoutePricingStatus(route).valid),
    [routes],
  )
  const [routeId, setRouteId] = useState(initialSnapshot.subscription?.routeId ?? availableRoutes[0]?.id ?? '')
  const [pickupIndex, setPickupIndex] = useState(initialSnapshot.subscription?.pickupIndex ?? 0)
  const [dropoffIndex, setDropoffIndex] = useState(initialSnapshot.subscription?.dropoffIndex ?? 1)
  const [period, setPeriod] = useState<SubscriptionPeriod>(initialSnapshot.subscription?.period ?? 'weekly')
  const [direction, setDirection] = useState<TravelDirection>(initialSnapshot.subscription?.direction ?? 'both')
  const [startDate, setStartDate] = useState(initialSnapshot.subscription?.startDate ?? localDateString())
  const [weekendDates, setWeekendDates] = useState(initialSnapshot.subscription?.weekendDates ?? [])
  const [weekendCandidate, setWeekendCandidate] = useState('')
  const [weekendError, setWeekendError] = useState('')
  const [subscription, setSubscription] = useState(initialSnapshot.subscription)
  const [renewal, setRenewal] = useState(initialSnapshot.renewal)
  const [payments, setPayments] = useState(initialSnapshot.payments)
  const [changeMode, setChangeMode] = useState(false)
  const [renewalMode, setRenewalMode] = useState(false)
  const [pendingChange, setPendingChange] = useState<PendingRouteChange | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null)
  const [paymentOutcome, setPaymentOutcome] = useState<PaymentStatus>('succeeded')
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [today, setToday] = useState(localDateString)
  const attempt = useRef(0)
  const subscriptionSequence = useRef(0)
  const appliedPaymentIds = useRef(new Set<string>())
  const activatedRenewalIds = useRef(new Set<string>())

  const selectedRoute = availableRoutes.find((route) => route.id === routeId)
  const pricingStatus = selectedRoute ? getRoutePricingStatus(selectedRoute) : null
  const quote = selectedRoute
    ? getSubscriptionQuote({ route: selectedRoute, pickupIndex, dropoffIndex, period, direction, startDate, weekendDates, today })
    : null
  const subscriptionRoute = routes.find((route) => route.id === subscription?.routeId)
  const remaining = subscription
    ? getRemainingSchedule(subscription.serviceDates, subscription.direction, subscription.completedJourneyIds, today)
    : null
  const originalFare = subscriptionRoute
    ? getJourneyFare(subscriptionRoute, subscription?.pickupIndex ?? -1, subscription?.dropoffIndex ?? -1)
    : null
  const revisedFare = selectedRoute ? getJourneyFare(selectedRoute, pickupIndex, dropoffIndex) : null
  const routeChangeCosts = remaining
    ? getRouteChangeCosts(originalFare, revisedFare, remaining)
    : null

  useEffect(() => {
    onSnapshotChange({ subscription, renewal, payments })
  }, [onSnapshotChange, payments, renewal, subscription])

  useEffect(() => {
    if (!subscription || !renewal
      || !isScheduledRenewalDue(subscription.endDate, renewal.startDate, today)
      || activatedRenewalIds.current.has(renewal.id)) return
    activatedRenewalIds.current.add(renewal.id)
    setSubscription({ ...renewal, status: 'Active · Preview' })
    setRenewal(null)
    onToast('Your scheduled preview renewal is now active. No real payment was taken.')
  }, [onToast, renewal, subscription, today])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentDate = localDateString()
      setToday((previous) => previous === currentDate ? previous : currentDate)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  function addWeekendDate() {
    const date = parseIsoDate(weekendCandidate)
    if (!date || weekendCandidate < today) {
      setWeekendError('Choose a valid date that is not in the past.')
      return
    }
    if (weekendCandidate < startDate) {
      setWeekendError('Choose a weekend date on or after the package start date.')
      return
    }
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      setWeekendError('Weekend packages can only include Saturdays and Sundays.')
      return
    }
    if (weekendDates.includes(weekendCandidate)) {
      setWeekendError('That date has already been selected.')
      return
    }
    setWeekendDates((current) => [...current, weekendCandidate].sort())
    setWeekendCandidate('')
    setWeekendError('')
  }

  function purchase() {
    if (!allowChanges) {
      setPaymentError('New subscriptions are unavailable while identity verification is restricted.')
      return
    }
    if (!isPreviewMode) {
      setPaymentError('Subscription purchase and renewal are not connected in API mode.')
      return
    }
    if (!selectedRoute || !quote?.valid || !pricingStatus?.valid) {
      onToast(quote?.error ?? 'Select a published route with valid pricing.')
      return
    }
    if (renewalMode && subscription && subscription.endDate >= today && quote.startDate <= subscription.endDate) {
      onToast('Choose a renewal start date after your current package ends.')
      return
    }
    subscriptionSequence.current += 1
    const nextSubscription: ActiveSubscription = {
      id: `PRE-SUB-${subscriptionSequence.current}`,
      routeId,
      pickupIndex,
      dropoffIndex,
      period,
      direction,
      startDate: quote.startDate,
      endDate: quote.endDate,
      serviceDates: quote.serviceDates,
      weekendDates: [...weekendDates],
      totalPaid: quote.total,
      completedJourneyIds: [],
      status: 'Active · Preview',
    }
    const scheduleAfterCurrent = renewalMode && subscription && subscription.endDate >= today
    if (scheduleAfterCurrent) {
      setRenewal({ ...nextSubscription, status: 'Scheduled · Preview' })
    } else {
      setSubscription(nextSubscription)
      setRenewal(null)
    }
    setPayments((current) => [{
      id: `PRE-PAY-${nextSubscription.id}`,
      date: new Date().toISOString(),
      description: `${formatPackage(period)} subscription`,
      amount: quote.total,
      status: 'succeeded',
    }, ...current])
    setChangeMode(false)
    setRenewalMode(false)
    onToast(scheduleAfterCurrent
      ? 'Preview renewal scheduled after the current subscription expires. No real payment was taken.'
      : 'Preview subscription activated. No real payment was taken.')
  }

  function startRouteChange() {
    if (!allowChanges) {
      onToast('Subscription changes are unavailable while identity verification is restricted.')
      return
    }
    if (!subscription) return
    setRouteId(subscription.routeId)
    setPickupIndex(subscription.pickupIndex)
    setDropoffIndex(subscription.dropoffIndex)
    setPeriod(subscription.period)
    setDirection(subscription.direction)
    setStartDate(subscription.startDate)
    setWeekendDates(subscription.weekendDates)
    setWeekendError('')
    setPendingChange(null)
    setPaymentStatus(null)
    setPaymentError('')
    setRenewalMode(false)
    setChangeMode(true)
  }

  function cancelRouteChange() {
    if (isProcessing) return
    if (subscription) {
      setRouteId(subscription.routeId)
      setPickupIndex(subscription.pickupIndex)
      setDropoffIndex(subscription.dropoffIndex)
      setPeriod(subscription.period)
      setDirection(subscription.direction)
    }
    setPendingChange(null)
    setPaymentStatus('cancelled')
    setChangeMode(false)
    setRenewalMode(false)
    setPaymentError('')
    onToast('Route change cancelled. Your current subscription is unchanged.')
  }

  function applyRouteChange(amountPaid: number) {
    if (!subscription || !selectedRoute || revisedFare === null || !pricingStatus?.valid || !routeChangeCosts || !remaining?.journeys) {
      setPaymentError('This route change is no longer valid. Your current subscription remains unchanged.')
      return
    }
    setSubscription((current) => current && current.id === subscription.id ? {
      ...current,
      routeId,
      pickupIndex,
      dropoffIndex,
      totalPaid: current.totalPaid + amountPaid,
    } : current)
    setChangeMode(false)
    setPendingChange(null)
    setPaymentStatus('succeeded')
    onToast('Preview route change applied for future eligible journeys only.')
  }

  function confirmRouteChange() {
    if (!allowChanges) {
      setPaymentError('Subscription changes are unavailable while identity verification is restricted.')
      return
    }
    if (!isPreviewMode) {
      setPaymentError('Route changes are not connected in API mode. Your current subscription remains unchanged.')
      return
    }
    if (!subscription || !selectedRoute || !pricingStatus?.valid || revisedFare === null || !routeChangeCosts || !remaining?.journeys) {
      setPaymentError('Choose a valid, priced route and a destination after pickup. Your current subscription is unchanged.')
      return
    }
    setPaymentError('')
    setPaymentStatus(null)
    if (routeChangeCosts.additionalPayment === 0) {
      applyRouteChange(0)
      return
    }
    attempt.current += 1
    setPendingChange({
      idempotencyKey: `${subscription.id}:${routeId}:${pickupIndex}:${dropoffIndex}:${attempt.current}`,
      subscriptionId: subscription.id,
      routeId,
      pickupIndex,
      dropoffIndex,
      amount: routeChangeCosts.additionalPayment,
    })
    setPaymentStatus('pending')
  }

  async function runPreviewPayment() {
    if (!allowChanges) {
      setPaymentError('Subscription changes are unavailable while identity verification is restricted.')
      return
    }
    if (!pendingChange || isProcessing) return
    setIsProcessing(true)
    setPaymentError('')
    try {
      const result = await platformService.simulatePayment({
        idempotencyKey: pendingChange.idempotencyKey,
        amount: pendingChange.amount,
        outcome: paymentOutcome,
      })
      setPaymentStatus(result.status)
      setPayments((current) => [{
        id: result.paymentId,
        date: new Date().toISOString(),
        description: 'Subscription route change',
        amount: result.amount,
        status: result.status,
      }, ...current.filter((payment) => payment.id !== result.paymentId)])

      if (result.status === 'succeeded') {
        const stillActive = subscription?.id === pendingChange.subscriptionId
        if (!stillActive || pendingChange.routeId !== routeId
          || pendingChange.pickupIndex !== pickupIndex
          || pendingChange.dropoffIndex !== dropoffIndex) {
          setPaymentError('The route proposal changed during payment. Your current subscription remains unchanged.')
          return
        }
        const application = applyPaidRouteChange(subscription, {
          routeId: pendingChange.routeId,
          pickupIndex: pendingChange.pickupIndex,
          dropoffIndex: pendingChange.dropoffIndex,
          additionalPayment: pendingChange.amount,
        }, result, appliedPaymentIds.current)
        if (!application.applied) {
          setPaymentError(`${application.reason ?? 'Payment was not verified.'} Your current subscription remains unchanged.`)
          return
        }
        appliedPaymentIds.current.add(result.paymentId)
        setSubscription(application.subscription)
        setChangeMode(false)
        setRenewalMode(false)
        setPendingChange(null)
        onToast('Preview route change applied for future eligible journeys only.')
      } else if (result.status === 'failed') {
        setPaymentError('Payment failed. Your original route and subscription remain active.')
        setPendingChange(null)
      } else if (result.status === 'cancelled') {
        setPaymentError('Payment was cancelled. Your original route and subscription remain active.')
        setPendingChange(null)
      }
    } catch (error) {
      setPaymentStatus('failed')
      setPendingChange(null)
      setPaymentError(error instanceof Error ? `Payment preview failed: ${error.message}` : 'Payment preview failed. Your current subscription remains unchanged.')
    } finally {
      setIsProcessing(false)
    }
  }

  function markNextJourneyComplete() {
    if (!isPreviewMode) {
      onToast('Journey completion is not connected in API mode.')
      return
    }
    if (!subscription || !remaining?.journeyIds.length) return
    const [nextJourney] = remaining.journeyIds
    if (!nextJourney.startsWith(`${today}:`)) {
      onToast('A journey can only be marked complete on its scheduled travel date in preview.')
      return
    }
    setSubscription((current) => current && current.id === subscription.id
      ? { ...current, completedJourneyIds: [...new Set([...current.completedJourneyIds, nextJourney])] }
      : current)
    onToast('Journey marked completed in preview. Remaining package journeys were updated.')
  }

  function renewSubscription() {
    if (!allowChanges) {
      onToast('New subscriptions are unavailable while identity verification is restricted.')
      return
    }
    if (!subscription) return
    const nextStartDate = getRenewalStartDate(subscription.endDate, today)
    setRouteId(subscription.routeId)
    setPickupIndex(subscription.pickupIndex)
    setDropoffIndex(subscription.dropoffIndex)
    setPeriod(subscription.period)
    setDirection(subscription.direction)
    setStartDate(nextStartDate)
    setWeekendDates([])
    setChangeMode(false)
    setRenewalMode(true)
    setPaymentStatus(null)
    onToast(`Review the renewal package. It will start ${nextStartDate} after your current package ends.`)
  }

  return (
    <div className="subscription-page">
      {!allowChanges && <div className="subscription-alert" role="status">Your account is restricted pending identity verification. Existing subscription and payment details remain available, but new subscriptions, renewals and route changes are disabled.</div>}
      <div className="subscription-intro">
        <p className="eyebrow">PASSENGER · MY SUBSCRIPTION</p>
        <h1>Travel on your terms</h1>
        <p className="muted">Choose a route and travel schedule. Your fare is calculated from the selected stop-to-stop segments.</p>
      </div>
      <div className="subscription-layout">
        <section className="panel subscription-builder">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{changeMode ? 'FUTURE JOURNEYS ONLY' : renewalMode ? 'SCHEDULED RENEWAL' : 'SUBSCRIPTION PLAN'}</p>
              <h2>{changeMode ? 'Preview a route change' : renewalMode ? 'Review your next package' : 'Choose your travel plan'}</h2>
              <p className="muted">Prepaid travel, not a stored-value wallet.</p>
            </div>
            <span className="stat-icon"><CalendarDays /></span>
          </div>
          {!availableRoutes.length && <div className="subscription-alert" role="status">No published routes are available yet. Ask an administrator to configure and publish route pricing.</div>}
          <div className="form-grid">
            <label className="field full-field">Route
              <select value={routeId} disabled={!availableRoutes.length || isProcessing || !!pendingChange || (!!subscription && !renewalMode && !changeMode)} onChange={(event) => {
                setRouteId(event.target.value)
                setPickupIndex(0)
                setDropoffIndex(1)
              }}>
                {availableRoutes.map((route) => <option key={route.id} value={route.id}>{route.name} via {route.via}</option>)}
              </select>
            </label>
            {selectedRoute && <>
              <label className="field">Pickup point
                <select value={pickupIndex} disabled={isProcessing || !!pendingChange || (!!subscription && !renewalMode && !changeMode)} onChange={(event) => {
                  const nextPickup = Number(event.target.value)
                  setPickupIndex(nextPickup)
                  if (dropoffIndex <= nextPickup) setDropoffIndex(Math.min(nextPickup + 1, selectedRoute.stops.length - 1))
                }}>
                  {selectedRoute.stops.slice(0, -1).map((stop, index) => <option key={`${stop}-${index}`} value={index}>{stop}</option>)}
                </select>
              </label>
              <label className="field">Drop-off point
                <select value={dropoffIndex} disabled={isProcessing || !!pendingChange || (!!subscription && !renewalMode && !changeMode)} onChange={(event) => setDropoffIndex(Number(event.target.value))}>
                  {selectedRoute.stops.map((stop, index) => index > pickupIndex
                    ? <option key={`${stop}-${index}`} value={index}>{stop}</option>
                    : null)}
                </select>
              </label>
            </>}
            <label className="field">Package
              <select disabled={changeMode || isProcessing || !!pendingChange || (!!subscription && !renewalMode)} value={period} onChange={(event) => setPeriod(event.target.value as SubscriptionPeriod)}>
                <option value="daily">Daily · one travel day</option>
                <option value="weekly">Weekly · five weekdays</option>
                <option value="monthly">Monthly · calendar month, weekdays</option>
                <option value="weekend">Weekend · selected dates</option>
              </select>
            </label>
            <label className="field">Journeys per day
              <select disabled={changeMode || isProcessing || !!pendingChange || (!!subscription && !renewalMode)} value={direction} onChange={(event) => setDirection(event.target.value as TravelDirection)}>
                <option value="morning">Morning only · 1 journey</option>
                <option value="evening">Evening only · 1 journey</option>
                <option value="both">Morning + Evening · 2 journeys</option>
              </select>
            </label>
            {period !== 'weekend' && <label className="field full-field">Start date
              <input type="date" min={renewalMode && subscription ? getRenewalStartDate(subscription.endDate, today) : today} disabled={changeMode || isProcessing || !!pendingChange || (!!subscription && !renewalMode)} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              {period === 'weekly' && <small>Includes the next five eligible Monday–Friday travel dates, starting on the selected date when it is a weekday.</small>}
              {period === 'monthly' && <small>Runs through the day before the next monthly anniversary (clamped to month-end); only weekdays count.</small>}
            </label>}
            {period === 'weekend' && <fieldset className="field full-field weekend-date-field">
              <legend>Weekend travel dates</legend>
              <div className="weekend-date-controls">
                <input aria-label="Select a Saturday or Sunday" type="date" min={period === 'weekend' && startDate > today ? startDate : today} disabled={changeMode || isProcessing || !!pendingChange || (!!subscription && !renewalMode)} value={weekendCandidate} onChange={(event) => {
                  setWeekendCandidate(event.target.value)
                  setWeekendError('')
                }} />
                <button className="button button-secondary" type="button" disabled={!weekendCandidate || changeMode || isProcessing || !!pendingChange || (!!subscription && !renewalMode)} onClick={addWeekendDate}>Add date</button>
              </div>
              <small>Choose future Saturdays and Sundays on or after {startDate}; each selected date is validated before it is added.</small>
              {weekendError && <span className="form-error" role="alert">{weekendError}</span>}
              {!!weekendDates.length && <ul className="weekend-date-list">{weekendDates.map((date) => <li key={date}>
                <span>{date}</span>
                {!changeMode && (!subscription || renewalMode) && <button type="button" className="icon-button" aria-label={`Remove weekend date ${date}`} disabled={isProcessing || !!pendingChange} onClick={() => setWeekendDates((current) => current.filter((value) => value !== date))}><X /></button>}
              </li>)}</ul>}
            </fieldset>}
          </div>

          {!changeMode && (!subscription || renewalMode) && quote && <section className="subscription-breakdown" aria-label="Subscription price breakdown">
            <div className="subscription-breakdown-heading"><h3>Price breakdown</h3><span className="preview-label">PREVIEW DATA</span></div>
            <div className="quote-line"><span>Selected journey</span><strong>{selectedRoute?.stops[pickupIndex]} → {selectedRoute?.stops[dropoffIndex]}</strong></div>
            <div className="quote-line"><span>One-way fare</span><strong>{quote.journeyFare === null ? '—' : formatGhs(quote.journeyFare)}</strong></div>
            <div className="quote-line"><span>Travel days × journeys per day</span><strong>{quote.eligibleDays} × {direction === 'both' ? 2 : 1} = {quote.journeys}</strong></div>
            <div className="quote-line"><span>Package dates</span><strong>{quote.startDate} – {quote.endDate}</strong></div>
            <div className="quote-line"><span>Administrator adjustment</span><strong>{formatGhs(quote.discount)}</strong></div>
            <div className="quote-total"><span>Subscription total</span><strong>{formatGhs(quote.total)}</strong></div>
            {quote.error && <p className="form-error" role="alert">{quote.error}</p>}
          </section>}

          {changeMode && subscription && <section className="route-change-impact" aria-label="Route change price impact">
            <div className="subscription-breakdown-heading"><h3>Route change impact</h3><span className="preview-label">PREVIEW ONLY</span></div>
            <p className="muted">The package duration and travel direction remain unchanged. The change applies only to future eligible journeys.</p>
            <dl className="impact-grid">
              <div><dt>Current route</dt><dd>{subscriptionRoute?.name ?? 'Unavailable'} · {subscriptionRoute?.stops[subscription.pickupIndex]} → {subscriptionRoute?.stops[subscription.dropoffIndex]}</dd></div>
              <div><dt>Proposed route</dt><dd>{selectedRoute?.name ?? 'Select a published route'} · {selectedRoute?.stops[pickupIndex]} → {selectedRoute?.stops[dropoffIndex]}</dd></div>
              <div><dt>Remaining service days / journeys</dt><dd>{remaining?.serviceDays ?? 0} days · {remaining?.journeys ?? 0} journeys</dd></div>
              <div><dt>Original remaining cost</dt><dd>{routeChangeCosts ? formatGhs(routeChangeCosts.originalRemainingCost) : '—'}</dd></div>
              <div><dt>Revised remaining cost</dt><dd>{routeChangeCosts ? formatGhs(routeChangeCosts.revisedRemainingCost) : '—'}</dd></div>
              <div className="impact-payment"><dt>Additional payment due</dt><dd>{routeChangeCosts ? formatGhs(routeChangeCosts.additionalPayment) : '—'}</dd></div>
            </dl>
            <p className="payment-safety-note"><ShieldCheck /> If payment fails, is cancelled, remains pending or cannot be verified, the original route remains active. A lower revised fare does not create a wallet credit or automatic refund.</p>
          </section>}

          {pendingChange ? <section className="payment-confirm-box" aria-live="polite">
            <strong>Additional payment required</strong>
            <p>Pay {formatGhs(pendingChange.amount)} for the remaining journeys. Your current subscription remains unchanged until this preview payment reports success.</p>
            {!isPreviewMode && <p className="payment-safety-note"><ShieldCheck /> Preview payments are disabled in API mode. No route change will be applied.</p>}
            {isPreviewMode && <>
            <label className="field">Preview payment result
              <select value={paymentOutcome} disabled={isProcessing} onChange={(event) => {
                if (isPaymentStatus(event.target.value)) setPaymentOutcome(event.target.value)
              }}>
                <option value="succeeded">Successful</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
                <option value="pending">Pending / not verified</option>
              </select>
            </label>
            <p className="preview-note">Simulation only—no payment provider is connected and no money is collected.</p>
            <button className="button button-primary" type="button" disabled={!allowChanges || isProcessing} onClick={runPreviewPayment}>
              <CreditCard />{isProcessing ? 'Checking payment…' : 'Run preview payment'}
            </button>
            </>}
            <button className="text-button" type="button" disabled={isProcessing} onClick={cancelRouteChange}>Cancel route change</button>
          </section> : <div className="subscription-actions">
            {changeMode && <button type="button" className="button button-secondary" disabled={isProcessing} onClick={cancelRouteChange}>Keep current route</button>}
            {renewalMode && <button type="button" className="button button-secondary" disabled={isProcessing} onClick={() => setRenewalMode(false)}>Cancel renewal setup</button>}
            <button
              type="button"
              className="button button-primary"
              disabled={!allowChanges || !isPreviewMode || isProcessing || (changeMode
                ? !selectedRoute || !pricingStatus?.valid || revisedFare === null || !remaining?.journeys
                : subscription && !renewalMode
                  ? !!renewal
                  : !selectedRoute || !pricingStatus?.valid || !quote?.valid)}
              onClick={changeMode ? confirmRouteChange : subscription && !renewalMode ? renewSubscription : purchase}
            >
              {changeMode
                ? (routeChangeCosts?.additionalPayment ? `Continue to payment · ${formatGhs(routeChangeCosts.additionalPayment)}` : 'Apply route change')
                : (subscription ? renewalMode ? 'Activate renewal in preview' : renewal ? 'Renewal scheduled' : 'Set up renewal' : 'Activate subscription in preview')}
              <ArrowRight size={17} />
            </button>
          </div>}
          {paymentStatus && !pendingChange && !paymentError && <p className={`payment-result ${paymentStatus}`} role="status">
            {paymentStatus === 'succeeded' ? 'Preview payment succeeded.' : `Payment ${paymentStatus}. Your current subscription was not changed.`}
          </p>}
          {!paymentError && paymentStatus === 'pending' && pendingChange && <p className="payment-result pending" role="status">Payment is not confirmed yet. The original route remains active.</p>}
          {paymentError && <p className="payment-result failed" role="alert">{paymentError}</p>}
          <p className="preview-note">{isPreviewMode
            ? 'Sample segment fares are illustrative only. Package calculations are for preview; payment confirmation, entitlement and route changes must be verified by the future backend.'
            : 'Subscription state, purchase, payment, and route changes are not connected in API mode. No subscription changes can be made from this screen.'}</p>
        </section>

        <aside className="subscription-side">
          {subscription ? <section className="panel current-subscription">
            <div className="section-heading"><h2>Current subscription</h2><span className="status-pill">{subscription.status}</span></div>
            <h3>{subscriptionRoute?.name ?? 'Route unavailable'}</h3>
            <p className="muted">{subscriptionRoute?.stops[subscription.pickupIndex]} → {subscriptionRoute?.stops[subscription.dropoffIndex]}</p>
            <div className="subscription-facts">
              <span>Package<strong>{formatPackage(subscription.period)}</strong></span>
              <span>Travel<strong>{formatDirection(subscription.direction)}</strong></span>
              <span>Start<strong>{subscription.startDate}</strong></span>
              <span>Expires<strong>{subscription.endDate}</strong></span>
              <span>Paid<strong>{formatGhs(subscription.totalPaid)}</strong></span>
              <span>Payment<strong>Paid · Preview</strong></span>
              <span>Remaining<strong>{remaining?.journeys ?? 0} journeys</strong></span>
            </div>
            <div className="button-row">
              <button type="button" className="button button-secondary" disabled={!allowChanges || !isPreviewMode || changeMode || !remaining?.journeys} onClick={startRouteChange}><MapPin />Change route</button>
              <button type="button" className="button button-secondary" disabled={!allowChanges || !isPreviewMode || changeMode || !!renewal} onClick={renewSubscription}><RefreshCw />{renewal ? 'Renewal scheduled' : 'Renew'}</button>
            </div>
            {!!remaining?.journeyIds.length && <button type="button" className="text-button mark-journey-button" disabled={!isPreviewMode || !remaining.journeyIds[0].startsWith(`${today}:`)} onClick={markNextJourneyComplete}>{remaining.journeyIds[0].startsWith(`${today}:`) ? 'Mark next journey complete · preview' : 'Journey completion available on travel date'}</button>}
            {renewal && <div className="renewal-notice"><strong>Renewal scheduled</strong><span>{formatPackage(renewal.period)} · {renewal.startDate} – {renewal.endDate}</span><small>Your current subscription remains active until it expires. This is a preview schedule.</small></div>}
            <p className="preview-note">Preview subscription state is held in this browser session. Route changes do not alter assigned or active trips.</p>
          </section> : <section className="panel subscription-empty">
            <span className="empty-icon"><MapPin /></span><h2>No active subscription</h2>
            <p className="muted">Choose a route and package to see your travel cost.</p>
          </section>}

          <section className="panel subscription-policy"><ShieldCheck /><div><strong>Prepaid travel, not stored value</strong><p>An additional amount is collected only for remaining journeys and must be confirmed before a route change is applied.</p></div></section>

          <section className="panel subscription-history">
            <div className="panel-heading"><h2>Payment history</h2><CreditCard /></div>
            {payments.length ? <div className="payment-history-list">{payments.map((payment) => <article key={payment.id}>
              <span className={`payment-history-icon ${payment.status}`}><CheckCircle2 /></span>
              <div><strong>{payment.description}</strong><small>{new Date(payment.date).toLocaleString()} · {payment.status} · preview</small></div>
              <b>{formatGhs(payment.amount)}</b>
            </article>)}</div> : <p className="muted subscription-history-empty">No subscription payments yet.</p>}
            <p className="preview-note">Payments are sample transaction records linked to the subscription, not passenger wallet top-ups.</p>
          </section>

          <section className="panel subscription-policy"><CheckCircle2 /><div><strong>Package schedule</strong><p>Weekly includes five eligible weekdays. Monthly runs from the selected date to the day before the next monthly anniversary, with weekday journeys only.</p></div></section>
        </aside>
      </div>
    </div>
  )
}
