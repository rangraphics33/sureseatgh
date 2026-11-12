import { ArrowRight, Clock3, MapPin, Moon, ShieldCheck, Sun, Ticket } from 'lucide-react'
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
    detail: 'Choose your route and select a pickup and drop-off point along it.',
  },
  {
    icon: <Clock3 />,
    title: 'Review your options',
    detail: 'Compare the available departure times and standard route fare.',
  },
  {
    icon: <Ticket />,
    title: 'Plan your journey',
    detail: 'Review your journey details and reserve your seat securely.',
  },
]

export default function LandingPage({ theme, routes, routesLoading, routesError, isPreviewMode, onRetryRoutes, onToggleTheme }: LandingPageProps) {
  // Preview routes are illustrative; keep them out of the public route list until the live route service is connected.
  const publishedRoutes = isPreviewMode ? [] : routes.filter((route) => route.published && getRoutePricingStatus(route).valid)

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
            <a href="#about">About</a>
            <a href="#contact">Contact</a>
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
            <a className="landing-header-book" href="/passenger/login?next=%2Fpassenger%2Fbooking">Book a seat <ArrowRight /></a>
          </div>
        </header>

        <div className="landing-hero-content">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow"><i /> SureSeat Ghana · Greater Accra</span>
            <h1>Your journey, <span>your seat.</span></h1>
            <p>Book a seat for your daily journey. Choose your route, pickup point and destination, then confirm your trip details before you travel.</p>
            <div className="landing-hero-actions">
              <a className="landing-button landing-button-primary" href="/passenger/login?next=%2Fpassenger%2Fbooking">
                Book your seat <ArrowRight />
              </a>
              <a className="landing-button landing-button-secondary" href="#routes">View routes</a>
            </div>
            <p className="landing-account-links">Already have an account? <a href="/passenger/login">Passenger sign in</a><span>·</span><a href="/driver/login">Driver sign in</a></p>
          </div>
          <div className="landing-hero-art" aria-label="SureSeat commuter van on a route">
            <div className="landing-art-glow" />
            <div className="landing-route-line"><span /><i /><i /><i /><b /></div>
            <div className="landing-van-motion"><img src={heroVan} alt="Yellow commuter van" /></div>
            <div className="landing-route-label"><span className="landing-live-dot" /> Greater Accra routes</div>
          </div>
        </div>
        <a className="landing-scroll-hint" href="#how-it-works">Discover SureSeat <span>↓</span></a>
      </section>

      <section className="landing-section landing-how" id="how-it-works">
        <div className="landing-section-heading">
          <p className="landing-section-eyebrow">A BETTER WAY TO PLAN YOUR COMMUTE</p>
          <h2>Less uncertainty. A clearer journey.</h2>
          <p>Plan your trip in three simple steps.</p>
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
            <h2>Available routes</h2>
          </div>
          <a className="landing-text-link" href="/passenger/booking">Open booking <ArrowRight /></a>
        </div>
        {isPreviewMode
          ? <div className="landing-routes-status">Routes are being prepared. Please check back soon.</div>
          : routesLoading
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
                <small>Standard route fare</small>
                <strong>{route.standardFare === undefined || route.standardFare === null ? 'Fare unavailable' : formatGhs(route.standardFare)}</strong>
              </div>
              <a className="landing-route-link" href={`/passenger/login?next=${encodeURIComponent(`/passenger/booking?route=${route.id}`)}`} aria-label={`Book ${route.name}`}>
                <ArrowRight />
              </a>
            </article>
          ))}
        </div>
              : <p className="landing-routes-status">No published routes are available yet.</p>}
        {!isPreviewMode && !routesLoading && !routesError && publishedRoutes.length > 0
          && <p className="landing-preview-disclaimer"><ShieldCheck /> The standard fare is confirmed by the booking service when you reserve a trip.</p>}
      </section>

      <section className="landing-section landing-about" id="about">
        <div className="landing-section-heading"><p className="landing-section-eyebrow">ABOUT SURESEAT GHANA</p><h2>Built around the journeys you make every day.</h2><p>SureSeat helps passengers plan shared transport journeys and gives drivers and operations teams the tools to keep each trip organized.</p></div>
        <div className="landing-about-points"><article><strong>For passengers</strong><p>Choose a route and stops, reserve a seat, and keep your trip details together.</p></article><article><strong>For drivers</strong><p>Access assigned journeys and passenger boarding details after approval.</p></article><article><strong>For operators</strong><p>Manage routes, departures, vehicles and the teams supporting each journey.</p></article></div>
      </section>

      <section className="landing-cta">
        <div>
          <p className="landing-section-eyebrow">YOUR JOURNEY STARTS HERE</p>
          <h2>Ready to book your seat?</h2>
          <p>Sign in as a passenger to choose your route and reserve a journey.</p>
        </div>
        <a className="landing-button landing-button-dark" href="/passenger/login?next=%2Fpassenger%2Fbooking">Book your seat <ArrowRight /></a>
      </section>

      <footer className="landing-footer" id="contact">
        <div className="landing-footer-main">
          <div className="landing-footer-brand">
            <a className="landing-brand" href="/" aria-label="SureSeat home">
              <span className="brand-mark">S</span>
              <span>Sure<span className="brand-gold">Seat</span></span>
            </a>
            <p>SureSeat Ghana helps make everyday journeys across Greater Accra easier to plan.</p>
          </div>
          <div className="landing-footer-links">
            <strong>Explore</strong>
            <a href="#routes">Routes</a>
            <a href="/passenger/login?next=%2Fpassenger%2Fbooking">Book a seat</a>
            <a href="/driver/login">Driver sign in</a>
            <a href="/admin/login">Team sign in</a>
          </div>
          <div className="landing-footer-links">
            <strong>Passenger</strong>
            <a href="/passenger/home">Passenger home</a>
            <a href="/passenger/my-trips">My trips</a>
            <a href="/passenger/my-subscription">Subscriptions</a>
          </div>
          <div className="landing-footer-links">
            <strong>Contact</strong>
            <a href="/passenger/login?next=%2Fpassenger%2Fhelp-support">Passenger support</a>
            <a href="/driver/login">Driver support access</a>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <span>© {new Date().getFullYear()} SureSeat Ghana</span>
          <span>Passenger support and trip assistance are available through your SureSeat account.</span>
        </div>
      </footer>
    </main>
  )
}
