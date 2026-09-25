import SunCalc from 'suncalc'
import * as solar from 'solar-calculator'

/**
 * Calculate solar declination for a given date using NOAA equations.
 * This is the latitude where the sun is directly overhead.
 * 
 * @param {Date} date
 * @returns {number} Declination in degrees (-23.44 to +23.44)
 */
export function calculateSolarDeclination(date) {
  const t = solar.century(date)
  return solar.declination(t)
}

/**
 * Calculate the subsolar point — where on Earth the sun is directly overhead.
 * 
 * @param {Date} time
 * @returns {{ latitude: number, longitude: number }} Subsolar point in degrees
 */
export function getSubsolarPoint(time) {
  const times = SunCalc.getTimes(time, 0, 0)
  const solarNoon = times.solarNoon
  const hoursSinceNoon = (time - solarNoon) / (1000 * 60 * 60)
  const longitude = -hoursSinceNoon * 15

  const latitude = calculateSolarDeclination(time)

  return { latitude, longitude }
}

/**
 * Calculate the sun's angular distance from a point on Earth's surface.
 * Returns the solar zenith angle: <90° = daylight, 90° = horizon, >90° = below horizon.
 * 
 * @param {number} lat - Observer latitude in degrees
 * @param {number} lon - Observer longitude in degrees
 * @param {Date} time
 * @returns {number} Angular distance in degrees (0 = sun directly overhead, 180 = antipodal)
 */
export function getSunAngle(lat, lon, time) {
  const subsolar = getSubsolarPoint(time)

  const lat1 = subsolar.latitude * Math.PI / 180
  const lon1 = subsolar.longitude * Math.PI / 180
  const lat2 = lat * Math.PI / 180
  const lon2 = lon * Math.PI / 180

  const angularDistance = Math.acos(
    Math.sin(lat1) * Math.sin(lat2) + 
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  ) * 180 / Math.PI

  return angularDistance
}

/**
 * Check if a point is in daylight at a given time.
 * Uses 95° threshold (between geometric sunset at 90° and civil twilight at 96°).
 *
 * @param {number} lat - Latitude in degrees
 * @param {number} lon - Longitude in degrees
 * @param {Date} time
 * @returns {boolean}
 */
export function isPointInDaylight(lat, lon, time) {
  return getSunAngle(lat, lon, time) < 95
}

/**
 * Horizon dip at typical cruise altitude (~35,000 ft).
 * Approx -3.32° below geometric horizon.
 */
const HORIZON_DIP_DEG = -3.32

const DAYLIGHT_FLOOR = 0.05
const FULL_DARK_SUN_ALT_DEG = -18
const EXTINCTION_AT_HORIZON = 0.13
const EXTINCTION_AT_ZENITH = 0.95

/**
 * Window viewability thresholds (altitude in degrees).
 * Below VIEWABILITY_FULL_DEG: fully visible from window (viewability = 1).
 * Above VIEWABILITY_ZERO_DEG: not visible from window (viewability = 0).
 * Linear fade in between.
 */
const VIEWABILITY_FULL_DEG = 45
const VIEWABILITY_ZERO_DEG = 75

/**
 * Bearing viewability thresholds (degrees from perpendicular).
 * Within BEARING_FULL_DEG of perpendicular (90°): fully visible (viewability = 1).
 * Within BEARING_ZERO_DEG of ahead/behind (0° or 180°): not visible (viewability = 0).
 * Linear fade in between.
 */
const BEARING_FULL_DEG = 35
const BEARING_ZERO_DEG = 60

// Degrees above the dip-corrected horizon over which viewability ramps 0→1
const HORIZON_FADE_DEG = 5.0

/**
 * Bin moon phase (0-1) into eight standard phase names.
 * Narrow bands for exact phases (New, First Quarter, Full, Last Quarter).
 *
 * @param {number} phase - Phase value from 0 to 1
 * @returns {string} Phase name
 */
function getMoonPhaseName(phase) {
  // Exact phases (narrow bands ±0.03)
  if (phase < 0.03 || phase > 0.97) return 'New moon'
  if (Math.abs(phase - 0.25) < 0.03) return 'First quarter'
  if (Math.abs(phase - 0.5) < 0.03) return 'Full moon'
  if (Math.abs(phase - 0.75) < 0.03) return 'Last quarter'

  // Intermediate phases
  if (phase < 0.25) return 'Waxing crescent'
  if (phase < 0.5) return 'Waxing gibbous'
  if (phase < 0.75) return 'Waning gibbous'
  return 'Waning crescent'
}

/**
 * Normalise angle to range [-180, 180].
 */
function normaliseAngle(deg) {
  let angle = deg % 360
  if (angle > 180) angle -= 360
  if (angle < -180) angle += 360
  return angle
}

/**
 * Compute flight heading from current point to next point.
 * Returns heading in degrees, measured clockwise from north.
 */
function computeHeading(lat1, lon1, lat2, lon2) {
  const lat1Rad = lat1 * Math.PI / 180
  const lon1Rad = lon1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const lon2Rad = lon2 * Math.PI / 180

  const dLon = lon2Rad - lon1Rad
  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  const headingRad = Math.atan2(y, x)
  return (headingRad * 180 / Math.PI + 360) % 360
}

// Per-point viewability at or above this counts towards the window-visible stat
// (roughly the midpoint of the altitude, bearing and horizon fades).
const WINDOW_VISIBLE_THRESHOLD = 0.5

/**
 * Compute moon visibility summary for a flight path.
 * Pre-computes window-visible time, phase, illumination, and per-point visibility/side.
 *
 * @param {Array} flightPoints - Array of {lat, lon, time} midpoint samples along the flight path
 * @param {number} departureMs - Departure time in milliseconds
 * @param {number} totalDurationMs - Total flight duration in milliseconds
 * @returns {{ windowVisibleMs: number, phase: number, illumination: number, phaseName: string, perPoint: Array } | null}
 */
export function computeMoonSummary(flightPoints, departureMs, totalDurationMs) {
  if (!flightPoints || flightPoints.length === 0) return null

  // Sample moon illumination once at midpoint
  const midpointMs = departureMs + totalDurationMs / 2
  const midpointDate = new Date(midpointMs)
  const moonIllum = SunCalc.getMoonIllumination(midpointDate)
  const phase = moonIllum.phase
  const illumination = moonIllum.fraction
  const phaseName = getMoonPhaseName(phase)

  // Walk flight points and accumulate window-visible time + per-point data.
  // Points are n midpoint samples, so each one represents totalDurationMs / n.
  let windowVisibleMs = 0
  let everAboveHorizon = false
  const msPerPoint = totalDurationMs / flightPoints.length
  const perPoint = []
  const horizonDipRad = HORIZON_DIP_DEG * Math.PI / 180

  for (let i = 0; i < flightPoints.length; i++) {
    const point = flightPoints[i]
    const { lat, lon, time } = point

    // Get moon position
    const moonPos = SunCalc.getMoonPosition(time, lat, lon)
    const altitudeRad = moonPos.altitude
    const altitudeDeg = altitudeRad * 180 / Math.PI
    const visible = altitudeRad > horizonDipRad
    if (visible) everAboveHorizon = true

    // Calculate altitude-based viewability (1 = fully visible, 0 = too high to see from window)
    let altitudeViewability
    if (altitudeDeg <= VIEWABILITY_FULL_DEG) {
      altitudeViewability = 1
    } else if (altitudeDeg >= VIEWABILITY_ZERO_DEG) {
      altitudeViewability = 0
    } else {
      altitudeViewability = (VIEWABILITY_ZERO_DEG - altitudeDeg) / (VIEWABILITY_ZERO_DEG - VIEWABILITY_FULL_DEG)
    }

    // Calculate flight heading (central difference for interior, forward/backward at ends)
    let heading
    if (i === 0) {
      // Forward difference at start
      const next = flightPoints[i + 1]
      heading = computeHeading(lat, lon, next.lat, next.lon)
    } else if (i === flightPoints.length - 1) {
      // Backward difference at end
      const prev = flightPoints[i - 1]
      heading = computeHeading(prev.lat, prev.lon, lat, lon)
    } else {
      // Central difference for interior points
      const prev = flightPoints[i - 1]
      const next = flightPoints[i + 1]
      heading = computeHeading(prev.lat, prev.lon, next.lat, next.lon)
    }

    // Determine side and bearing viewability
    let side = null
    let bearingViewability = 1
    if (visible) {
      // Convert suncalc azimuth (south = 0, west = positive) to north-clockwise
      // suncalc: south = 0, west = π/2, north = π, east = -π/2
      // We want: north = 0, east = 90, south = 180, west = 270
      const azimuthRad = moonPos.azimuth
      let moonAzimuth = (azimuthRad * 180 / Math.PI + 180 + 360) % 360

      // Calculate relative bearing
      const relativeBearing = normaliseAngle(moonAzimuth - heading)

      // Positive = right, negative = left
      side = relativeBearing > 0 ? 'right' : 'left'

      // Calculate bearing-based viewability (fades near directly-ahead or directly-behind)
      const absBearing = Math.abs(relativeBearing) // [0, 180]
      const distFromPerp = Math.abs(absBearing - 90) // 0 at perpendicular, 90 at ahead/behind
      if (distFromPerp <= BEARING_FULL_DEG) {
        bearingViewability = 1
      } else if (distFromPerp >= BEARING_ZERO_DEG) {
        bearingViewability = 0
      } else {
        bearingViewability = (BEARING_ZERO_DEG - distFromPerp) / (BEARING_ZERO_DEG - BEARING_FULL_DEG)
      }
    }

    // Combine altitude, bearing, and horizon-edge viewability
    const horizonFade = Math.max(0, Math.min(1, (altitudeDeg - HORIZON_DIP_DEG) / HORIZON_FADE_DEG))
    const viewability = altitudeViewability * bearingViewability * horizonFade

    if (viewability >= WINDOW_VISIBLE_THRESHOLD) {
      windowVisibleMs += msPerPoint
    }

    // Calculate brightness based on moon illumination and sky darkness
    const sunPos = SunCalc.getPosition(time, lat, lon)
    const sunAltitudeDeg = sunPos.altitude * 180 / Math.PI

    let skyFactor
    if (sunAltitudeDeg >= 0) {
      skyFactor = DAYLIGHT_FLOOR
    } else if (sunAltitudeDeg <= FULL_DARK_SUN_ALT_DEG) {
      skyFactor = 1.0
    } else {
      skyFactor = DAYLIGHT_FLOOR +
        (1.0 - DAYLIGHT_FLOOR) * (sunAltitudeDeg / FULL_DARK_SUN_ALT_DEG)
    }

    const dipCorrectedAltRad = altitudeRad - horizonDipRad
    const extinction = EXTINCTION_AT_HORIZON +
      (EXTINCTION_AT_ZENITH - EXTINCTION_AT_HORIZON) * Math.max(0, Math.min(1, Math.sin(dipCorrectedAltRad)))

    const brightness = illumination * skyFactor * extinction

    perPoint.push({ visible, side, viewability, altitudeDeg, brightness, extinction })
  }

  // Return null if the moon is never above the dip-corrected horizon
  if (!everAboveHorizon) return null

  return {
    windowVisibleMs,
    phase,
    illumination,
    phaseName,
    perPoint
  }
}