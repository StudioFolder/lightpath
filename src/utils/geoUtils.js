import * as THREE from 'three'

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