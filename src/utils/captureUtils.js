import * as THREE from 'three'
import { latLonToVector3, getFlightScale } from './geoUtils'

const WIDTH = 2160
const HEIGHT = 3840

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

  // --- Camera positioning (replicates centerCameraOnFlight) ---
  const { cameraRadius, scaleFactor } = getFlightScale(distance)
  const radius = cameraRadius

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

  // Base position above midpoint
  const basePosition = latLonToVector3(midLat, midLon, radius)

  // 10° south tilt scaled by scaleFactor
  const tiltAngle = (10 * scaleFactor) * Math.PI / 180
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

  // --- Offscreen render ---
  const renderTarget = new THREE.WebGLRenderTarget(WIDTH, HEIGHT)

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

      if (ring) {
        ring.position.copy(point)
        ring.visible = true
        ring.material.opacity = 1
      }
    })
  }

  renderer.setRenderTarget(renderTarget)
  renderer.render(scene, captureCamera)

  // Restore transition labels
  savedLabelStates.forEach(({ label, visible, opacity, position, ringVisible, ringOpacity, ringPosition }) => {
    label.visible = visible
    label.material.opacity = opacity
    label.position.copy(position)
    const ring = label.userData.ring
    if (ring) {
      ring.visible = ringVisible
      ring.material.opacity = ringOpacity
      if (ringPosition) ring.position.copy(ringPosition)
    }
  })

  // Restore original draw range
  if (progressTubeMesh) {
    progressTubeMesh.geometry.setDrawRange(savedStart, savedCount)
  }

  renderer.setRenderTarget(null)

  // --- Read pixels and flip vertically ---
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  renderer.readRenderTargetPixels(renderTarget, 0, 0, WIDTH, HEIGHT, pixels)

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')

  // WebGL pixels are bottom-up — flip row by row
  const imageData = ctx.createImageData(WIDTH, HEIGHT)
  for (let row = 0; row < HEIGHT; row++) {
    const srcOffset = row * WIDTH * 4
    const dstOffset = (HEIGHT - 1 - row) * WIDTH * 4
    imageData.data.set(pixels.subarray(srcOffset, srcOffset + WIDTH * 4), dstOffset)
  }
  ctx.putImageData(imageData, 0, 0)

  // --- Logo watermark (uses preloaded image) ---
  try {
    const logoImg = await preloadLogo(isBWMode)
    const logoHeight = 120
    const logoWidth = logoImg.width * (logoHeight / logoImg.height)
    ctx.globalAlpha = 0.85
    ctx.drawImage(logoImg, 96, 120, logoWidth, logoHeight)
    ctx.globalAlpha = 1.0
  } catch {
    // Logo failed to load — continue without it
  }

  // --- Export PNG blob ---
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))

  // --- Cleanup ---
  renderTarget.dispose()

  return blob
}
