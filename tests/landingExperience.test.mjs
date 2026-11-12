import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../src/components/LandingPage.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

test('public homepage leads booking through passenger sign-in and keeps staff sign-in secondary', () => {
  assert.match(page, /href="\/passenger\/login\?next=%2Fpassenger%2Fbooking"[\s\S]*?Book your seat/)
  assert.match(page, /Passenger sign in[\s\S]*?Driver sign in/)
  assert.match(page, /href="\/admin\/login">Team sign in/)
  assert.match(page, /id="about"/)
  assert.match(page, /id="contact"/)
})

test('public homepage hides preview route data and removes the first-visit splash', () => {
  assert.match(page, /isPreviewMode \? \[\] : routes\.filter/)
  assert.doesNotMatch(page, /sample data|Preview mode ·|welcome-splash/)
})

test('hero van enters on page load and visibly moves while respecting reduced-motion preference', () => {
  assert.match(page, /className="landing-van-motion"/)
  assert.match(styles, /@keyframes landing-van-arrive/)
  assert.match(styles, /@keyframes landing-van-drive/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.landing-van-motion/)
})
