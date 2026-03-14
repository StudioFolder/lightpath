import * as THREE from 'three'
import { latLonToVector3 } from './geoUtils'

const WIDTH = 2160
const HEIGHT = 2880
const AIRPORT_DOTS_CAPTURE_MULTIPLIER = 1.0
const TRANSITION_LABEL_CAPTURE_SCALE = 1.5

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const logoCache = {}

export function preloadLogo(isBWMode) {
  const src = isBWMode ? '/lightpath-logo-black.png' : '/lightpath-logo-white.png'
  if (!logoCache[src]) {
    logoCache[src] = loadImage(src)
  }
  return logoCache[src]
}

export async function captureFlightImage(renderer, scene, progressTubeMesh, transitionLabels, flightCurve, flightData, isBWMode) {
  const { departure, arrival, distance } = flightData

  // --- Camera positioning (independent from interactive view) ---

  // Great-circle midpoint
  const lat1 = departure.lat * Math.PI / 180
  const lon1 = departure.lon * Math.PI / 180
  const lat2 = arrival.lat * Math.PI / 180
  const lon2 = arrival.lon * Math.PI / 180

  const angularDistance = Math.acos(
    Math.sin(lat1) * Math.sin(lat2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  )

  const a = Math.sin(0.5 * angularDistance) / Math.sin(angularDistance)
  const b = Math.sin(0.5 * angularDistance) / Math.sin(angularDistance)

  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
  const z = a * Math.sin(lat1) + b * Math.sin(lat2)

  const midLat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
  const midLon = Math.atan2(y, x) * 180 / Math.PI

  // Camera distance for capture (portrait frame, FOV 75°)
  // Globe radius = 1.0
  let radius

  if (distance >= 7500) {
    // Very long flights: full earth in frame
    radius = 4.4
  } else if (distance >= 5000) {
    // Long flights: show the full globe with padding
    radius = 4.2
  } else if (distance >= 2000) {
    // Medium flights: interpolate between zoomed and full globe
    const t = (distance - 2000) / 3000
    radius = 3.0 + t * 0.6  // 3.4 at 2000km → 4.0 at 5000km
  } else if (distance >= 500) {
    // Short flights
    const t = (distance - 500) / 1500
    radius = 2.6 + t * 0.6  // 2.8 at 500km → 3.4 at 2000km
  } else {
    // Very short flights
    radius = 2.4
  }

  // Base position above midpoint
  const basePosition = latLonToVector3(midLat, midLon, radius)

  // South tilt — reduced at close zoom to avoid pushing airports out of frame
  let tiltDegrees
  if (distance >= 5000) {
    tiltDegrees = 5
  } else if (distance >= 3000) {
    tiltDegrees = 7
  } else if (distance >= 2000) {
    tiltDegrees = 4
  } else if (distance >= 1000) {
    tiltDegrees = 2
  } else {
    tiltDegrees = 0.5
  }
  const tiltAngle = tiltDegrees * Math.PI / 180
  const planeNormal = basePosition.clone().normalize()

  const south = new THREE.Vector3(0, -1, 0)
  const east = new THREE.Vector3().crossVectors(planeNormal, south).normalize()
  const actualSouth = new THREE.Vector3().crossVectors(east, planeNormal).normalize()

  const tiltedNormal = planeNormal.clone()
    .multiplyScalar(Math.cos(tiltAngle))
    .add(actualSouth.multiplyScalar(Math.sin(tiltAngle)))
    .normalize()

  const targetPosition = tiltedNormal.multiplyScalar(radius)

  // Create capture camera (FOV 75, portrait aspect)
  const captureCamera = new THREE.PerspectiveCamera(75, WIDTH / HEIGHT, 0.01, 1000)
  captureCamera.position.copy(targetPosition)
  captureCamera.lookAt(0, 0, 0)

  // --- Render to canvas at capture resolution ---
  // Save renderer state
  const savedWidth = renderer.domElement.width
  const savedHeight = renderer.domElement.height
  const savedPixelRatio = renderer.getPixelRatio()

  // Resize renderer to capture resolution (false = don't update CSS, invisible to user)
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)

  // Force full path visibility for capture
  let savedStart, savedCount
  if (progressTubeMesh) {
    const geo = progressTubeMesh.geometry
    savedStart = geo.drawRange.start
    savedCount = geo.drawRange.count
    const totalIndices = geo.index ? geo.index.count : geo.attributes.position.count
    geo.setDrawRange(0, totalIndices)
  }

  // Force all transition labels and rings visible at correct positions
  const savedLabelStates = []
  if (transitionLabels && transitionLabels.length > 0 && flightCurve) {
    const elementScale = transitionLabels[0].parent?.userData?.elementScale || 1.0
    transitionLabels.forEach(label => {
      const ring = label.userData.ring
      savedLabelStates.push({
        label,
        visible: label.visible,
        opacity: label.material.opacity,
        position: label.position.clone(),
        ringVisible: ring?.visible,
        ringOpacity: ring?.material?.opacity,
        ringPosition: ring?.position?.clone(),
      })

      // Position using curve
      const t = label.userData.transitionT
      const point = flightCurve.getPoint(t)
      const offset = point.clone().normalize().multiplyScalar(0.06 * elementScale)
      label.position.copy(point).add(offset)
      label.visible = true
      label.material.opacity = 1

      // Save and apply independent capture scale for transition labels
      savedLabelStates[savedLabelStates.length - 1].labelScale = label.scale.clone()
      label.scale.multiplyScalar(TRANSITION_LABEL_CAPTURE_SCALE)

      if (ring) {
        ring.position.copy(point)
        ring.visible = true
        ring.material.opacity = 1
        savedLabelStates[savedLabelStates.length - 1].ringScale = ring.scale.clone()
        ring.scale.multiplyScalar(TRANSITION_LABEL_CAPTURE_SCALE)
      }
    })
  }

  // Scale flight group elements for portrait frame
  let captureScaleRatio
  if (distance >= 7500) {
    captureScaleRatio = 2.5
  } else if (distance >= 5000) {
    captureScaleRatio = 1.8
  } else if (distance >= 2000) {
    captureScaleRatio = 1.4
  } else if (distance >= 500) {
    captureScaleRatio = 1.2
  } else {
    captureScaleRatio = 1.0
  }
  const savedScales = []
  const flightGroup = progressTubeMesh?.parent
  if (flightGroup) {
    flightGroup.traverse(child => {
      if (child === progressTubeMesh) return  // Don't scale the tube itself
      // Skip transition labels and rings — they have their own scale
      if (transitionLabels && transitionLabels.includes(child)) return
      if (transitionLabels && transitionLabels.some(l => l.userData.ring === child)) return
      if (child.isSprite || child.isMesh) {
        savedScales.push({
          object: child,
          scale: child.scale.clone(),
        })
        child.scale.multiplyScalar(captureScaleRatio)
      }
    })
  }

  // Hide thin base tube to prevent ghost line artifact in capture
  let thinTubeSaved = null
  if (flightGroup) {
    flightGroup.children.forEach(child => {
      if (child.isMesh && child !== progressTubeMesh && child.material?.transparent && child.material?.opacity <= 0.3) {
        thinTubeSaved = { mesh: child, visible: child.visible }
        child.visible = false
      }
    })
  }

  // Scale airport dots layer for high-res capture
  const airportDots = scene.getObjectByName('airportDots')
  let savedPointSize = null
  if (airportDots && airportDots.material) {
    savedPointSize = airportDots.material.size
    const viewportCSSHeight = savedHeight / savedPixelRatio
    const scaleFactor = HEIGHT / viewportCSSHeight
    airportDots.material.size = savedPointSize * scaleFactor * AIRPORT_DOTS_CAPTURE_MULTIPLIER
    airportDots.material.needsUpdate = true
  }

  renderer.render(scene, captureCamera)

  // Restore airport dots size
  if (airportDots && savedPointSize !== null) {
    airportDots.material.size = savedPointSize
    airportDots.material.needsUpdate = true
  }

  // Restore thin base tube
  if (thinTubeSaved) {
    thinTubeSaved.mesh.visible = thinTubeSaved.visible
  }

  // Restore element scales
  savedScales.forEach(({ object, scale }) => {
    object.scale.copy(scale)
  })

  // Restore transition labels
  savedLabelStates.forEach(({ label, visible, opacity, position, labelScale, ringVisible, ringOpacity, ringPosition, ringScale }) => {
    label.visible = visible
    label.material.opacity = opacity
    label.position.copy(position)
    if (labelScale) label.scale.copy(labelScale)
    const ring = label.userData.ring
    if (ring) {
      ring.visible = ringVisible
      ring.material.opacity = ringOpacity
      if (ringPosition) ring.position.copy(ringPosition)
      if (ringScale) ring.scale.copy(ringScale)
    }
  })

  // Restore original draw range
  if (progressTubeMesh) {
    progressTubeMesh.geometry.setDrawRange(savedStart, savedCount)
  }

  // Copy rendered frame to a 2D canvas (same color pipeline as viewport — no conversion needed)
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.drawImage(renderer.domElement, 0, 0)

  // Restore renderer state (next animation frame re-renders the viewport normally)
  renderer.setPixelRatio(savedPixelRatio)
  renderer.setSize(savedWidth / savedPixelRatio, savedHeight / savedPixelRatio, false)

  return canvas
}
