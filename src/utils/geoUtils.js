import * as THREE from 'three'

/**
 * Calculate scale parameters based on flight distance.
 * Returns camera radius and a general scale factor for visual elements.
 * Flights over 2,000 km use default scale. Below that, elements
 * progressively shrink and camera zooms closer.
 * 
 * @param {number} distanceKm - Flight distance in kilometers
 * @returns {{ cameraRadius: number, scaleFactor: number }}
 */
export function getFlightScale(distanceKm) {
  const d = Math.max(200, distanceKm)
  
  let cameraRadius, scaleFactor
  
  if (d >= 2000) {
    cameraRadius = 3.5
    scaleFactor = 1.0
  } else if (d >= 1000) {
    const t = (d - 1000) / 1000
    cameraRadius = 2.7 + t * 0.6
    scaleFactor = 0.7 + t * 0.3
  } else if (d >= 500) {
    const t = (d - 500) / 500
    cameraRadius = 2.4 + t * 0.4
    scaleFactor = 0.5 + t * 0.2
  } else {
    const t = Math.max(0, (d - 200) / 300)
    cameraRadius = 2.3 + t * 0.2
    scaleFactor = 0.4 + t * 0.1
  }
  
  // Compensate for closer camera making elements appear larger
  const defaultRadius = 3.5
  const cameraCompensation = cameraRadius / defaultRadius
  scaleFactor *= cameraCompensation
  
  return { cameraRadius, scaleFactor }
}

/**
 * Calculate a viewport-based scale factor to prevent 3D elements
 * (labels, tubes, plane icon) from growing too large on wide screens.
 * Returns 1.0 at or below the reference width, and progressively
 * smaller values above it.
 * 
 * @param {number} windowWidth - Current window inner width in pixels
 * @param {number} [referenceWidth=1440] - Width at which scale is 1.0
 * @returns {number} Scale multiplier (0 < value <= 1.0)
 */
export function getViewportScale(windowWidth, referenceWidth = 1440) {
  return Math.min(1.0, referenceWidth / windowWidth)
}

/**
 * Convert geographic coordinates (latitude, longitude) to a Three.js 3D vector.
 * Uses the app's coordinate convention: Y-up, negative X at 0° longitude.
 * 
 * @param {number} lat - Latitude in degrees (-90 to 90)
 * @param {number} lon - Longitude in degrees (-180 to 180)
 * @param {number} radius - Distance from origin (Earth radius in scene units)
 * @returns {THREE.Vector3} Position in 3D space
 */
export function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}