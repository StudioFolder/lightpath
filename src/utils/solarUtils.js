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