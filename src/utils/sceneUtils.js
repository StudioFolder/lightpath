import * as THREE from 'three'

/**
 * Create a canvas texture for an airport label (departure or arrival).
 * Returns a Promise that resolves with the texture once the icon loads.
 * 
 * @param {string} code - Airport IATA code (e.g., "MXP")
 * @param {string} iconSrc - Path to the icon SVG
 * @param {boolean} isBW - Whether to use BW mode colors
 * @returns {Promise<THREE.CanvasTexture>}
 */
export function createAirportLabelTexture(code, iconSrc, isBW = false) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    canvas.width = 300
    canvas.height = 110

    const icon = new Image()
    icon.onload = () => {
      // Draw rounded rectangle background
      const radius = 64
      context.fillStyle = isBW ? '#f0f0f0' : '#0c0c0c'
      context.beginPath()
      context.moveTo(radius, 0)
      context.lineTo(canvas.width - radius, 0)
      context.quadraticCurveTo(canvas.width, 0, canvas.width, radius)
      context.lineTo(canvas.width, canvas.height - radius)
      context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height)
      context.lineTo(radius, canvas.height)
      context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius)
      context.lineTo(0, radius)
      context.quadraticCurveTo(0, 0, radius, 0)
      context.closePath()
      context.fill()

      // Layout: icon + gap + text, centered
      context.font = 'bold 56px system-ui, -apple-system, sans-serif'
      const textWidth = context.measureText(code).width
      const iconSize = 48
      const gap = 28
      const totalWidth = iconSize + gap + textWidth
      const startX = (canvas.width - totalWidth) / 2

      // Draw icon
      const iconY = (canvas.height - iconSize) / 2 - 1
      context.drawImage(icon, startX, iconY, iconSize, iconSize)

      // Draw text
      context.fillStyle = isBW ? '#1a1a1a' : '#ffffff'
      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.fillText(code, startX + iconSize + gap, canvas.height / 2)

      resolve(new THREE.CanvasTexture(canvas))
    }
    icon.src = iconSrc
  })
}

/**
 * Create a canvas texture for a transition label (sunrise/sunset time marker).
 * Returns a Promise that resolves with the texture once the icon loads.
 * 
 * @param {string} timeText - Display time (e.g., "2h 15m")
 * @param {string} transitionType - 'sunrise' or 'sunset'
 * @param {boolean} isBW - Whether to use BW mode colors
 * @returns {Promise<THREE.CanvasTexture>}
 */
export function createTransitionLabelTexture(timeText, transitionType, isBW) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    canvas.width = 280
    canvas.height = 100

    const iconSrc = transitionType === 'sunrise'
      ? (isBW ? '/sunrise-icon-bw.svg' : '/sunrise-icon.svg')
      : (isBW ? '/sunset-icon-bw.svg' : '/sunset-icon.svg')

    const icon = new Image()
    icon.onload = () => {
      context.fillStyle = isBW ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)'
      context.font = '40px system-ui'

      const iconSize = 40
      const gap = 12
      const textWidth = context.measureText(timeText).width
      const totalWidth = iconSize + gap + textWidth
      const startX = (canvas.width - totalWidth) / 2

      // Draw text first
      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.fillText(timeText, startX, canvas.height / 2)

      // Draw icon after text
      const iconY = (canvas.height - iconSize) / 2 - 5
      const iconX = startX + textWidth + gap
      context.drawImage(icon, iconX, iconY, iconSize, iconSize)

      resolve(new THREE.CanvasTexture(canvas))
    }
    icon.src = iconSrc
  })
}