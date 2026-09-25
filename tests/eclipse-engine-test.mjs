/**
 * Validation of src/utils/eclipseUtils.js against the NASA/Espenak path tables.
 * Run with: npm run test:eclipse
 *
 * Checks, for every non-Limits row of both 2027 path tables:
 *   - m at the central-line point, at the row's UT, is < 1e-4 Earth radii;
 *   - the central duration (totality or annularity) for a static sea-level
 *     observer at that point matches the table within 1 s.
 * Moving-observer checks along the 2027 Aug 02 central line at 900 km/h.
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { ECLIPSES, VALID_HOURS_FROM_T0, evaluateElements, getLocalCircumstances, findContacts } from '../src/utils/eclipseUtils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const loadFixture = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', name), 'utf8'))

const M_TOLERANCE = 1e-4        // Earth radii (~0.6 km)
const DURATION_TOLERANCE_S = 1
const SAMPLE_STEP_S = 5         // static-observer sampling; bisection refines to < 0.1 s

function rowDate(eclipse, row) {
  const [y, mo, d] = eclipse.date.split('-').map(Number)
  const [hh, mm] = row.time.split(':').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, hh, mm))
}

/** Samples for an observer that does not move, centred on `centre`. */
function staticTrack(lat, lon, heightM, centre, halfWindowS, stepS) {
  const out = []
  for (let s = -halfWindowS; s <= halfWindowS; s += stepS) {
    out.push({ lat, lon, heightM, time: new Date(centre.getTime() + s * 1000) })
  }
  return out
}

function fmtS(s) { return `${s.toFixed(1)} s` }

// --- Static checks against every row ----------------------------------------

let failures = 0
const summary = []

for (const fixtureName of ['SE2027Aug02T-path.json', 'SE2027Feb06A-path.json']) {
  const fixture = loadFixture(fixtureName)
  const eclipse = ECLIPSES[fixture.eclipse]
  const expectedPhase = eclipse.type
  let maxM = 0, maxMRow = null
  let maxDurErr = 0, maxDurRow = null
  let maxAltErr = 0

  for (const row of fixture.rows) {
    const date = rowDate(eclipse, row)
    const { lat, lon } = row.central
    const c = getLocalCircumstances(eclipse, lat, lon, 0, date)

    if (c.m > maxM) { maxM = c.m; maxMRow = row.time }
    if (c.m >= M_TOLERANCE) { failures++; console.error(`  FAIL ${fixture.eclipse} ${row.time}: m = ${c.m.toExponential(3)}`) }
    if (c.phase !== expectedPhase) { failures++; console.error(`  FAIL ${fixture.eclipse} ${row.time}: phase ${c.phase}, expected ${expectedPhase}`) }

    // Sun altitude from ζ (informational; the table rounds to whole degrees)
    const altErr = Math.abs(Math.asin(Math.min(1, c.zeta)) * 180 / Math.PI - row.sunAltDeg)
    if (altErr > maxAltErr) maxAltErr = altErr

    // Central duration for a static sea-level observer at the central point
    const halfWindow = Math.ceil(row.durationS / 2) + 30
    const contacts = findContacts(eclipse, staticTrack(lat, lon, 0, date, halfWindow, SAMPLE_STEP_S))
    if (contacts.centralDurationMs === null) {
      failures++; console.error(`  FAIL ${fixture.eclipse} ${row.time}: no central phase found`); continue
    }
    const durErr = Math.abs(contacts.centralDurationMs / 1000 - row.durationS)
    if (durErr > maxDurErr) { maxDurErr = durErr; maxDurRow = row.time }
    if (durErr > DURATION_TOLERANCE_S) { failures++; console.error(`  FAIL ${fixture.eclipse} ${row.time}: duration ${contacts.centralDurationMs / 1000} s vs table ${row.durationS} s`) }
  }

  summary.push({ eclipse: fixture.eclipse, rows: fixture.rows.length, maxM, maxMRow, maxDurErr, maxDurRow, maxAltErr })
}

console.log('Static checks against NASA path tables')
for (const s of summary) {
  console.log(`  ${s.eclipse}: ${s.rows} rows`)
  console.log(`    max m at central line   ${s.maxM.toExponential(2)} Earth radii (${(s.maxM * 6378.14).toFixed(2)} km) at ${s.maxMRow}  [limit ${M_TOLERANCE}]`)
  console.log(`    max duration error      ${fmtS(s.maxDurErr)} at ${s.maxDurRow}  [limit ${DURATION_TOLERANCE_S} s]`)
  console.log(`    max sun-altitude error  ${s.maxAltErr.toFixed(2)}° (table is rounded to 1°)`)
}

// --- Moving-observer checks ---------------------------------------------------

const aug = loadFixture('SE2027Aug02T-path.json')
const eclipse = ECLIPSES.SE2027Aug02T
const i = aug.rows.findIndex(r => r.time === '09:30')
const here = aug.rows[i].central, next = aug.rows[i + 1].central
const centre = rowDate(eclipse, aug.rows[i])

// Bearing of the shadow's motion along the central line
const toRad = x => x * Math.PI / 180, toDeg = x => x * 180 / Math.PI
function bearing(a, b) {
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}
function destination(a, bearingDeg, distanceM) {
  const R = 6371000, δ = distanceM / R, θ = toRad(bearingDeg)
  const φ1 = toRad(a.lat), λ1 = toRad(a.lon)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: toDeg(φ2), lon: toDeg(λ2) }
}

const SPEED_MS = 900 / 3.6
const HEIGHT_M = 11000
const shadowBearing = bearing(here, next)
function movingTrack(bearingDeg) {
  const out = []
  for (let s = -600; s <= 600; s += 2) {
    const p = destination(here, bearingDeg, SPEED_MS * s)
    out.push({ lat: p.lat, lon: p.lon, heightM: HEIGHT_M, time: new Date(centre.getTime() + s * 1000) })
  }
  return out
}

const staticAtHeight = findContacts(eclipse, staticTrack(here.lat, here.lon, HEIGHT_M, centre, 600, 2))
const withShadow = findContacts(eclipse, movingTrack(shadowBearing))
const against = findContacts(eclipse, movingTrack((shadowBearing + 180) % 360))

const d = r => r.centralDurationMs / 1000
console.log('\nMoving observer, 2027 Aug 02 central line at 09:30 UT, 900 km/h, 11 000 m')
console.log(`  shadow bearing            ${shadowBearing.toFixed(1)}°`)
console.log(`  static observer totality  ${fmtS(d(staticAtHeight))}  (table, sea level: ${fmtS(aug.rows[i].durationS)})`)
console.log(`  flying with the shadow    ${fmtS(d(withShadow))}`)
console.log(`  flying against it         ${fmtS(d(against))}`)
console.log(`  max obscuration (moving)  ${withShadow.maximum.obscuration.toFixed(3)} at ${withShadow.maximum.time.toISOString()} (${withShadow.maximum.phase})`)

try {
  assert.ok(staticAtHeight.centralDurationMs > 0, 'static observer sees totality')
  assert.ok(d(withShadow) > d(staticAtHeight), 'flying with the shadow lengthens totality')
  assert.ok(d(against) < d(staticAtHeight), 'flying against the shadow shortens totality')
  assert.equal(withShadow.maximum.phase, 'total')
  assert.ok(withShadow.c2 < withShadow.c3, 'C2 before C3')
  // The ±10 min track never reaches the partial contacts, so they are outside the samples
  assert.equal(withShadow.c1, null)
  assert.equal(withShadow.c4, null)
} catch (err) {
  failures++
  console.error(`  FAIL ${err.message}`)
}

// A track that never reaches the umbra should report partial contacts only
const wideOfPath = findContacts(eclipse, staticTrack(here.lat + 3, here.lon, 0, centre, 5400, 10))
try {
  assert.equal(wideOfPath.c2, null)
  assert.equal(wideOfPath.c3, null)
  assert.ok(wideOfPath.c1 && wideOfPath.c4, 'partial contacts found 3° off the path')
  assert.equal(wideOfPath.maximum.phase, 'partial')
  assert.ok(wideOfPath.maximum.obscuration > 0 && wideOfPath.maximum.obscuration < 1)
  console.log(`  3° north of the path      partial only, max obscuration ${wideOfPath.maximum.obscuration.toFixed(3)}`)
} catch (err) {
  failures++
  console.error(`  FAIL ${err.message}`)
}

// --- Validity window --------------------------------------------------------

// Global first/last partial contacts (P1/P4): the penumbra first and last
// touches the Earth when the shadow axis is l1 + 1 Earth radii from the centre
// of the fundamental plane. Root-find that on the raw polynomials and require
// both roots to sit inside the window the engine honours.
function globalPartialContacts(ecl) {
  const f = t => { const e = evaluateElements(ecl, t); return Math.hypot(e.x, e.y) - e.l1 - 1 }
  const roots = []
  const step = 1 / 60
  for (let t = -6; t < 6; t += step) {
    const a = f(t), b = f(t + step)
    if ((a < 0) === (b < 0)) continue
    let lo = t, hi = t + step, flo = a
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi), fm = f(mid)
      if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm } else hi = mid
    }
    roots.push(0.5 * (lo + hi))
  }
  return { p1: roots[0], p4: roots[roots.length - 1] }
}

console.log(`\nValidity window ±${VALID_HOURS_FROM_T0} h from t0`)
for (const ecl of Object.values(ECLIPSES)) {
  const { p1, p4 } = globalPartialContacts(ecl)
  console.log(`  ${ecl.id}: P1 at t = ${p1.toFixed(3)} h, P4 at t = ${p4.toFixed(3)} h`)
  try {
    assert.ok(Number.isFinite(p1) && Number.isFinite(p4), 'found P1 and P4')
    assert.ok(p1 < 0 && p4 > 0, 'P1 before t0 and P4 after it')
    assert.ok(-VALID_HOURS_FROM_T0 <= p1 && p4 <= VALID_HOURS_FROM_T0, `P1/P4 inside ±${VALID_HOURS_FROM_T0} h`)
  } catch (err) {
    failures++
    console.error(`  FAIL ${ecl.id} validity window: ${err.message}`)
  }
}

// Outside the window the engine must report no eclipse
try {
  const farAway = getLocalCircumstances(eclipse, here.lat, here.lon, 0, new Date(centre.getTime() + 5 * 3600 * 1000))
  assert.equal(farAway.phase, 'none')
  assert.equal(farAway.obscuration, 0)
} catch (err) {
  failures++
  console.error(`  FAIL outside window: ${err.message}`)
}

console.log(failures === 0 ? '\nAll eclipse engine checks passed' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
