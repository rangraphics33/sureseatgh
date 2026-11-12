import { useEffect, useState } from 'react'
import { ArrowRight, Check, Clock3, MapPin, Moon, ShieldCheck, Sun, Ticket } from 'lucide-react'
import heroVan from '../assets/a_realistic_high_resolution_png_cutout_of_the_sam.png'
import type { Route } from '../data/routes'
import { formatGhs, getRoutePricingStatus } from '../utils/pricing'

type LandingPageProps = {
  theme: 'light' | 'dark'
  routes: Route[]
  routesLoading: boolean
  routesError: string
  isPreviewMode: boolean
  onRetryRoutes: () => void
  onToggleTheme: () => void
}

const steps = [
  {
    icon: <MapPin />,
    title: 'Choose your route',
    detail: 'Pick a published route, then choose your pickup and destination in order.',
  },
  {
    icon: <Clock3 />,
    title: 'Review your options',
    detail: 'Check the departure window and fare before selecting a ride.',
  },
  {
    icon: <Ticket />,
    title: 'Plan your journey',
    detail: 'Review your trip details and confirm your booking in the passenger workspace.',
  },
]

export default function LandingPage({ theme, routes, routesLoading, routesError, isPreviewMode, onRetryRoutes, onToggleTheme }: LandingPageProps) {
  const [showWelcome, setShowWelcome] = useState(() => {
    if (window.location.pathname !== '/' || sessionStorage.getItem('sureseat-welcome-seen') === 'true') return false
    sessionStorage.setItem('sureseat-welcome-seen', 'true')
    return true
  })
  const publishedRoutes = routes.filter((route) => route.published && getRoutePricingStatus(route).valid)

  useEffect(() => {
    if (!showWelcome) return
    const timer = window.setTimeout(() => setShowWelcome(false), 1600)
    return () => window.clearTimeout(timer)
  }, [showWelcome])

  if (showWelcome) {
    return (
      <main className="welcome-splash" aria-label="Welcome to SureSeat">
        <div className="welcome-splash-content">
          <span className="brand-mark">S</span>
          <p className="landing-brand">Sure<span className="brand-gold">Seat</span></p>
          <img src={heroVan} alt="" />
          <h1>Your seat. Your journey.</h1>
          <p>Everyday journeys, made clearer.</p>
          <button className="landing-button landing-button-primary" type="button" onClick={() => setShowWelcome(false)}>
            Continue <ArrowRight />
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="landing-page">
      <section className="landing-hero">
        <header className="landing-header">
          <a className="landing-brand" href="/" aria-label="SureSeat home">
            <span className="brand-mark">S</span>
            <span>Sure<span className="brand-gold">Seat</span></span>
          </a>
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#routes">Routes</a>
            <a href="/passenger/login">Passenger sign in</a>
            <a href="/passenger/booking">Plan a trip</a>
            <a href="/driver/login">Driver portal</a>
            <a href="/admin/login">Admin portal</a>
          </nav>
          <div className="landing-header-actions">
            <button
              className="landing-theme-toggle"
              type="button"
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              onClick={onToggleTheme}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </button>
            <a className="landing-login" href="/passenger/home">Passenger portal</a>
          </div>
        </header>

        <div className="landing-hero-content">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow"><i /> Greater Accra · {isPreviewMode ? 'Route preview' : 'Current routes'}</span>
            <h1>Your seat is <span>already waiting.</span></h1>
            <p>Plan your daily commute, choose your pickup and destination, and review available ride options — all in one place.</p>
            <div className="landing-hero-actions">
              <a className="landing-button landing-button-primary" href="/passenger/booking">
                Explore booking <ArrowRight />
              </a>
              <a className="landing-button landing-button-secondary" href="#routes">See available routes</a>
            </div>
            <p className="landing-preview-note"><ShieldCheck />{isPreviewMode
              ? 'Preview mode · No live bookings or vehicle tracking'
              : 'Booking requests are checked against route, fare and availability. Live vehicle tracking is not available yet.'}</p>
          </div>
          <div className="landing-hero-art" aria-label="SureSeat commuter van on a route">
            <div className="landing-art-glow" />
            <div className="landing-route-line"><span /><i /><i /><i /><b /></div>
            <img src={heroVan} alt="Yellow commuter van" />
            <div className="landing-route-label"><span className="landing-live-dot" /> Greater Accra routes</div>
          </div>
        </div>
        <a className="landing-scroll-hint" href="#how-it-works">Discover SureSeat <span>↓</span></a>
      </section>

      <section className="landing-section landing-how" id="how-it-works">
        <div className="landing-section-heading">
          <p className="landing-section-eyebrow">A BETTER WAY TO PLAN YOUR COMMUTE</p>
          <h2>Less uncertainty. A clearer journey.</h2>
          <p>{isPreviewMode
            ? 'Explore the booking flow with sample data while the live services are being prepared.'
            : 'Explore available routes and ride information.'}</p>
        </div>
        <div className="landing-steps">
          {steps.map((step, index) => (
            <article className="landing-step" key={step.title}>
              <span className="landing-step-icon">{step.icon}</span>
              <span className="landing-step-number">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-routes" id="routes">
        <div className="landing-section-heading landing-routes-heading">
          <div>
            <p className="landing-section-eyebrow">START WITH A ROUTE</p>
          <h2>{isPreviewMode ? 'Routes in the current preview' : 'Available routes'}</h2>
          </div>
          <a className="landing-text-link" href="/passenger/booking">Open booking <ArrowRight /></a>
        </div>
        {routesLoading
          ? <p className="landing-routes-status" role="status">Loading available routes…</p>
          : routesError
            ? <div className="landing-routes-status" role="alert"><p>{routesError}</p><button className="landing-text-link" type="button" onClick={onRetryRoutes}>Retry loading routes <ArrowRight /></button></div>
            : publishedRoutes.length
              ? <div className="landing-route-cards">
          {publishedRoutes.map((route) => (
            <article className="landing-route-card" key={route.id}>
              <div className="landing-route-card-icon"><MapPin /></div>
              <div className="landing-route-card-copy">
                <h3>{route.name}</h3>
                <p>Via {route.via} · {route.stops.length} pickup points</p>
              </div>
              <div className="landing-route-fare">
                <small>{isPreviewMode ? 'Standard fare preview' : 'Standard route fare'}</small>
                <strong>{route.standardFare === undefined || route.standardFare === null ? (isPreviewMode ? 'Fare preview' : 'Fare unavailable') : formatGhs(route.standardFare)}</strong>
              </div>
              <a className="landing-route-link" href={`/passenger/booking?route=${encodeURIComponent(route.id)}`} aria-label={`${isPreviewMode ? 'Preview booking' : 'Book'} for ${route.name}`}>
                <ArrowRight />
              </a>
            </article>
          ))}
        </div>
              : <p className="landing-routes-status">No published routes are available yet.</p>}
        {!routesLoading && !routesError && publishedRoutes.length > 0
          && <p className="landing-preview-disclaimer"><Check />{isPreviewMode
            ? ' Routes and fares shown here are sample data and may change before launch.'
            : ' The standard fare is confirmed by the booking service when you reserve a trip.'}</p>}
      </section>

      <section className="landing-cta">
        <div>
          <p className="landing-section-eyebrow">YOUR JOURNEY STARTS HERE</p>
          <h2>Ready to explore the booking flow?</h2>
          <p>Choose a route and see how a SureSeat journey will come together.</p>
        </div>
        <a className="landing-button landing-button-dark" href="/passenger/booking">Explore booking <ArrowRight /></a>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-main">
          <div className="landing-footer-brand">
            <a className="landing-brand" href="/" aria-label="SureSeat home">
              <span className="brand-mark">S</span>
              <span>Sure<span className="brand-gold">Seat</span></span>
            </a>
            <p>Planning more reliable everyday journeys across Greater Accra.</p>
          </div>
          <div className="landing-footer-links">
            <strong>Explore</strong>
            <a href="#routes">Routes</a>
            <a href="/passenger/booking">Passenger booking</a>
            <a href="/driver/overview">Driver workspace</a>
          </div>
          <div className="landing-footer-links">
            <strong>Passenger</strong>
            <a href="/passenger/home">Passenger home</a>
            <a href="/passenger/my-trips">My trips</a>
            <a href="/passenger/my-subscription">Subscriptions</a>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <span>© {new Date().getFullYear()} SureSeat Ghana</span>
          <span>{isPreviewMode ? 'Preview workspace · Live services are not connected' : 'Payment confirmation and live vehicle location are not available yet'}</span>
        </div>
      </footer>
    </main>
  )
}
