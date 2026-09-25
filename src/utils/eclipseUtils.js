/**
 * Solar eclipse engine built on Besselian elements.
 *
 * Pure JavaScript, no dependencies. Deliberately independent of suncalc
 * (its moon position is off by arcminutes, which moves the shadow by tens of
 * kilometres) and of three.
 *
 * References: Meeus, "Elements of Solar Eclipses 1951–2200"; Explanatory
 * Supplement to the Astronomical Almanac, ch. 11. Elements are copied from
 * NASA/Espenak (eclipse.gsfc.nasa.gov), which uses ΔT = 71.7 s for 2027.
 *
 * Conventions, verified against the NASA path tables:
 *   - longitude is east-positive;
 *   - t (hours) = UT + ΔT/3600 − t0, i.e. the polynomials run on TDT;
 *   - H = μ + λ − 0.00417807·ΔT (degrees);
 *   - ρ sin φ′ and ρ cos φ′ use the 0.99664719 flattening factor plus the
 *     height term h/6378140;
 *   - L1 = l1 − ζ·tan f1 and L2 = l2 − ζ·tan f2;
 *   - total when L2 < 0 and m < |L2|; annular when L2 > 0 and m < L2.
 */

const DEG = Math.PI / 180
const FLATTENING_FACTOR = 0.99664719 // 1 − f for the ellipsoid NASA uses
const EARTH_EQUATORIAL_RADIUS_M = 6378140
const DELTA_T_HOUR_ANGLE_RATE = 0.00417807 // degrees of hour angle per second of ΔT
// NASA fits the polynomials over six hours centred on t0 and states they are
// valid for t0 ± 3 h. The global partial phase of SE2027Feb06A runs from about
// t = −3.02 h to +3.05 h, so the window is widened slightly; the cubic error
// that close to the fitted span is negligible. Outside it the honest answer is
// "no eclipse" rather than an extrapolated cubic. The test suite checks that
// every catalogue entry's first and last partial contacts fall inside.
export const VALID_HOURS_FROM_T0 = 3.25

/**
 * Catalogue of Besselian elements, copied from NASA:
 *   eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2027Feb06Abeselm.html
 *   eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2027Aug02Tbeselm.html
 *
 * Each polynomial array is [a0, a1, a2, a3] in t = hours from t0 (TDT).
 * d and μ are in degrees; x, y, l1, l2 in Earth equatorial radii.
 */
export const ECLIPSES = {
  SE2027Feb06A: {
    id: 'SE2027Feb06A',
    type: 'annular',
    date: '2027-02-06',
    t0: 16.0,
    deltaT: 71.6,
    x:  [0.111743, 0.4664823, -0.0000325, -0.0000032],
    y:  [-0.273277, 0.2031840, 0.0001025, -0.0000025],
    d:  [-15.54794, 0.012383, 0.000004],
    l1: [0.571927, -0.0000653, -0.0000101],
    l2: [0.025661, -0.0000650, -0.0000100],
    mu: [56.49306, 15.000512],
    tanF1: 0.0047426,
    tanF2: 0.0047190,
  },
  SE2027Aug02T: {
    id: 'SE2027Aug02T',
    type: 'total',
    date: '2027-08-02',
    t0: 10.0,
    deltaT: 71.7,
    x:  [-0.019645, 0.5447105, -0.0000444, -0.0000091],
    y:  [0.160063, -0.2111569, -0.0001217, 0.0000037],
    d:  [17.76247, -0.010181, -0.000004],
    l1: [0.530596, 0.0000138, -0.0000128],
    l2: [-0.015464, 0.0000137, -0.0000128],
    mu: [328.42249, 15.002093],
    tanF1: 0.0046064,
    tanF2: 0.0045834,
  },
}

/** Horner evaluation of [a0, a1, a2, ...] at t. */
function poly(coeffs, t) {
  let r = 0
  for (let i = coeffs.length - 1; i >= 0; i--) r = r * t + coeffs[i]
  return r
}

/** Hours from t0 in TDT for a UT instant: t = UT + ΔT/3600 − t0. */
export function ephemerisHours(eclipse, date) {
  const [y, mo, d] = eclipse.date.split('-').map(Number)
  const dayStartMs = Date.UTC(y, mo - 1, d)
  const utHours = (date.getTime() - dayStartMs) / 3.6e6
  return utHours + eclipse.deltaT / 3600 - eclipse.t0
}

/** Evaluate the six time-dependent elements at t hours from t0. */
export function evaluateElements(eclipse, t) {
  return {
    x:  poly(eclipse.x, t),
    y:  poly(eclipse.y, t),
    d:  poly(eclipse.d, t),
    l1: poly(eclipse.l1, t),
    l2: poly(eclipse.l2, t),
    mu: poly(eclipse.mu, t),
  }
}

/**
 * Project the observer into the fundamental plane.
 * ξ points east, η north, ζ towards the moon along the shadow axis; ζ > 0
 * means the sun is above the observer's horizon (approximately).
 */
function observerCoordinates(eclipse, elements, lat, lon, heightM) {
  const phi = lat * DEG
  const u1 = Math.atan(FLATTENING_FACTOR * Math.tan(phi))
  const hTerm = heightM / EARTH_EQUATORIAL_RADIUS_M
  const rhoSin = FLATTENING_FACTOR * Math.sin(u1) + hTerm * Math.sin(phi)
  const rhoCos = Math.cos(u1) + hTerm * Math.cos(phi)

  const H = (elements.mu + lon - DELTA_T_HOUR_ANGLE_RATE * eclipse.deltaT) * DEG
  const d = elements.d * DEG
  const sinH = Math.sin(H), cosH = Math.cos(H)
  const sinD = Math.sin(d), cosD = Math.cos(d)

  return {
    xi:   rhoCos * sinH,
    eta:  rhoSin * cosD - rhoCos * cosH * sinD,
    zeta: rhoSin * sinD + rhoCos * cosH * cosD,
  }
}

/**
 * Fraction of the sun's disc covered by the moon, from the overlap of two
 * discs: sun of radius 1, moon of radius k, centres s apart (sun radii).
 */
export function discObscuration(k, s) {
  if (s >= 1 + k) return 0
  if (s <= Math.abs(1 - k)) return k >= 1 ? 1 : k * k
  const s2 = s * s, k2 = k * k
  const a1 = k2 * Math.acos(Math.max(-1, Math.min(1, (s2 + k2 - 1) / (2 * s * k))))
  const a2 = Math.acos(Math.max(-1, Math.min(1, (s2 + 1 - k2) / (2 * s))))
  const root = Math.sqrt(Math.max(0, (-s + k + 1) * (s + k - 1) * (s - k + 1) * (s + k + 1)))
  return (a1 + a2 - 0.5 * root) / Math.PI
}

/**
 * Local circumstances for an observer at one instant.
 *
 * @param {object} eclipse   catalogue entry
 * @param {number} lat       degrees, north-positive
 * @param {number} lon       degrees, east-positive
 * @param {number} heightM   metres above the ellipsoid (use cruise altitude for aircraft)
 * @param {Date}   date      UT instant
 * @returns {{ m, L1, L2, magnitude, obscuration, phase, zeta }}
 *   phase is 'none' | 'partial' | 'total' | 'annular'
 */
export function getLocalCircumstances(eclipse, lat, lon, heightM, date) {
  const t = ephemerisHours(eclipse, date)
  if (Math.abs(t) > VALID_HOURS_FROM_T0) {
    return { m: Infinity, L1: 0, L2: 0, magnitude: 0, obscuration: 0, phase: 'none', zeta: 0 }
  }
  const el = evaluateElements(eclipse, t)
  const { xi, eta, zeta } = observerCoordinates(eclipse, el, lat, lon, heightM)

  const u = el.x - xi
  const v = el.y - eta
  const m = Math.hypot(u, v)
  const L1 = el.l1 - zeta * eclipse.tanF1
  const L2 = el.l2 - zeta * eclipse.tanF2

  let phase = 'none'
  if (zeta > 0 && m < L1) {
    if (L2 < 0 && m < -L2) phase = 'total'
    else if (L2 > 0 && m < L2) phase = 'annular'
    else phase = 'partial'
  }

  // Sun radius (L1 + L2)/2, moon radius (L1 − L2)/2, separation m, all in the
  // same units, so the moon/sun ratio is (L1 − L2)/(L1 + L2).
  const magnitude = phase === 'none' ? 0 : (L1 - m) / (L1 + L2)
  const obscuration = phase === 'none'
    ? 0
    : discObscuration((L1 - L2) / (L1 + L2), (2 * m) / (L1 + L2))

  return { m, L1, L2, magnitude, obscuration, phase, zeta }
}

function isCentral(phase) {
  return phase === 'total' || phase === 'annular'
}

/** Shortest signed longitude difference b − a, in degrees. */
function lonDelta(a, b) {
  let d = b - a
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/**
 * Contact times for a moving observer.
 *
 * @param {object} eclipse  catalogue entry
 * @param {Array<{lat:number, lon:number, time:Date|number, heightM?:number}>} samples
 *   time-stamped positions along the path, in chronological order. A static
 *   site is just a track whose samples share one position.
 * @returns {{
 *   c1: Date|null, c2: Date|null, c3: Date|null, c4: Date|null,
 *   maximum: { time: Date, obscuration: number, magnitude: number, phase: string } | null,
 *   partialDurationMs: number|null, centralDurationMs: number|null
 * }}
 *   Contacts are found by bisection between the samples that bracket them,
 *   interpolating the position linearly in time. Contacts that fall outside
 *   the sampled interval are null. c1/c2 are the first entries, c3/c4 the
 *   last exits, so a track that dips in and out of the umbra reports the
 *   outer envelope.
 */
export function findContacts(eclipse, samples) {
  const pts = samples.map(s => ({
    lat: s.lat,
    lon: s.lon,
    heightM: s.heightM ?? 0,
    time: s.time instanceof Date ? s.time.getTime() : Number(s.time),
  }))
  if (pts.length === 0) {
    return { c1: null, c2: null, c3: null, c4: null, maximum: null, partialDurationMs: null, centralDurationMs: null }
  }

  const positionAt = (timeMs) => {
    if (timeMs <= pts[0].time) return pts[0]
    if (timeMs >= pts[pts.length - 1].time) return pts[pts.length - 1]
    let lo = 0, hi = pts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].time <= timeMs) lo = mid
      else hi = mid
    }
    const a = pts[lo], b = pts[hi]
    const f = b.time === a.time ? 0 : (timeMs - a.time) / (b.time - a.time)
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + lonDelta(a.lon, b.lon) * f,
      heightM: a.heightM + (b.heightM - a.heightM) * f,
      time: timeMs,
    }
  }

  const circumstancesAt = (timeMs) => {
    const p = positionAt(timeMs)
    return getLocalCircumstances(eclipse, p.lat, p.lon, p.heightM, new Date(timeMs))
  }

  const circ = pts.map(p => circumstancesAt(p.time))

  // Continuous functions whose sign changes at the contacts: negative inside.
  const partialFn = c => c.m - c.L1
  const centralFn = c => c.m - Math.abs(c.L2)
  const inPartial = c => c.phase !== 'none'
  const inCentral = c => isCentral(c.phase)

  // Bisect for the root of fn between two sample times; 40 halvings of a
  // sample interval leave far less than a millisecond.
  const bisect = (fn, tA, tB) => {
    let a = tA, b = tB
    let fa = fn(circumstancesAt(a))
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (a + b)
      const fm = fn(circumstancesAt(mid))
      if ((fa < 0) === (fm < 0)) { a = mid; fa = fm } else { b = mid }
      if (b - a < 0.1) break
    }
    return 0.5 * (a + b)
  }

  const findEntriesAndExits = (inside, fn) => {
    const entries = [], exits = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = inside(circ[i]), b = inside(circ[i + 1])
      if (!a && b) entries.push(bisect(fn, pts[i].time, pts[i + 1].time))
      if (a && !b) exits.push(bisect(fn, pts[i].time, pts[i + 1].time))
    }
    return { entries, exits }
  }

  const partial = findEntriesAndExits(inPartial, partialFn)
  const central = findEntriesAndExits(inCentral, centralFn)

  const c1 = partial.entries.length ? partial.entries[0] : null
  const c4 = partial.exits.length ? partial.exits[partial.exits.length - 1] : null
  const c2 = central.entries.length ? central.entries[0] : null
  const c3 = central.exits.length ? central.exits[central.exits.length - 1] : null

  // Maximum: mid-central-phase when there is one, otherwise a golden-section
  // search around the best sample.
  let maximum = null
  if (c2 !== null && c3 !== null) {
    const time = 0.5 * (c2 + c3)
    const c = circumstancesAt(time)
    maximum = { time: new Date(time), obscuration: c.obscuration, magnitude: c.magnitude, phase: c.phase }
  } else {
    let best = 0
    for (let i = 1; i < circ.length; i++) if (circ[i].obscuration > circ[best].obscuration) best = i
    if (circ[best].obscuration > 0) {
      let a = pts[Math.max(0, best - 1)].time
      let b = pts[Math.min(pts.length - 1, best + 1)].time
      const g = (Math.sqrt(5) - 1) / 2
      let x1 = b - g * (b - a), x2 = a + g * (b - a)
      let f1 = circumstancesAt(x1).obscuration, f2 = circumstancesAt(x2).obscuration
      while (b - a > 100) {
        if (f1 < f2) { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = circumstancesAt(x2).obscuration }
        else { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = circumstancesAt(x1).obscuration }
      }
      const time = 0.5 * (a + b)
      const c = circumstancesAt(time)
      maximum = { time: new Date(time), obscuration: c.obscuration, magnitude: c.magnitude, phase: c.phase }
    }
  }

  return {
    c1: c1 === null ? null : new Date(c1),
    c2: c2 === null ? null : new Date(c2),
    c3: c3 === null ? null : new Date(c3),
    c4: c4 === null ? null : new Date(c4),
    maximum,
    partialDurationMs: c1 !== null && c4 !== null ? c4 - c1 : null,
    centralDurationMs: c2 !== null && c3 !== null ? c3 - c2 : null,
  }
}
