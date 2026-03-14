import { preloadLogo } from './captureUtils'

const CARD_WIDTH  = 2160
const CARD_HEIGHT = 2880

const planeCache = {}

function preloadPlaneIcon(isBWMode) {
  const src = isBWMode ? '/plane-icon-bw.svg' : '/plane-icon.svg'
  if (!planeCache[src]) {
    planeCache[src] = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }
  return planeCache[src]
}

export async function generateShareCard(globeCanvas, cardData, isBWMode) {
  const {
    departureCode,
    arrivalCode,
    departureCity,
    arrivalCity,
    departureCountry,
    arrivalCountry,
    distance,
    durationHours,
    durationMins,
    daylightHours,
    daylightMins,
    darknessHours,
    darknessMins,
    departureDateTime,
    departureTZ,
    arrivalDateTime,
    arrivalTZ,
  } = cardData

  // Ensure custom fonts are ready and plane icon is loaded before drawing
  const [planeImg] = await Promise.all([
    preloadPlaneIcon(isBWMode).catch(() => null),
    document.fonts.ready,
  ])

  // Color palette
  const textPrimary   = isBWMode ? 'rgba(40, 40, 40, 0.8)'    : 'rgba(255, 255, 255, 0.85)'
  const textSecondary = isBWMode ? 'rgba(40, 40, 40, 0.6)'    : 'rgba(255, 255, 255, 0.6)'
  const textTertiary  = isBWMode ? 'rgba(40, 40, 40, 0.4)'    : 'rgba(255, 255, 255, 0.4)'
  const panelBg       = isBWMode ? 'rgba(245, 245, 245, 0.7)' : 'rgba(30, 30, 30, 0.45)'
  const borderColor   = isBWMode ? 'rgba(0, 0, 0, 0.1)'       : 'rgba(255, 255, 255, 0.08)'
  const dividerColor  = isBWMode ? 'rgba(0, 0, 0, 0.08)'      : 'rgba(255, 255, 255, 0.08)'

  // Create output canvas and draw globe as background
  const canvas = document.createElement('canvas')
  canvas.width  = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.drawImage(globeCanvas, 0, 0)

  // --- 1. Logo (centered, top) ---
  try {
    const logoImg = await preloadLogo(isBWMode)
    const logoH = 80
    const logoW = logoImg.width * (logoH / logoImg.height)
    ctx.globalAlpha = 0.9
    ctx.drawImage(logoImg, (CARD_WIDTH - logoW) / 2, 80, logoW, logoH)
    ctx.globalAlpha = 1.0
  } catch {
    // Logo unavailable — continue without it
  }

  // --- 2. Info panel (glassmorphism rounded rect) ---
  const panelX = 664
  const panelY = 2320
  const panelW = 832
  const panelH = 496
  const panelR = 32

  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(panelX, panelY, panelW, panelH, panelR)
  } else {
    roundRectFallback(ctx, panelX, panelY, panelW, panelH, panelR)
  }
  ctx.fillStyle = panelBg
  ctx.fill()
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 2
  ctx.stroke()

  // --- 3. Stats row ---
  const stats = [
    { label: 'DISTANCE', value: distance.toLocaleString('en-US') + ' KM' },
    { label: 'DURATION', value: `${durationHours}h ${durationMins}m` },
    { label: 'DAYLIGHT', value: `${daylightHours}h ${daylightMins}m` },
    { label: 'DARKNESS', value: `${darknessHours}h ${darknessMins}m` },
  ]
  const colCenters = [800, 984, 1176, 1360]

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  stats.forEach((stat, i) => {
    const cx = colCenters[i]

    ctx.font = '500 24px ABCRepro, system-ui, sans-serif'
    ctx.fillStyle = textTertiary
    ctx.fillText(stat.label, cx, 2376)

    ctx.font = '500 24px ABCRepro, system-ui, sans-serif'
    ctx.fillStyle = textPrimary
    ctx.fillText(stat.value, cx, 2408)
  })

  // --- 4. Divider ---
  ctx.beginPath()
  ctx.moveTo(704, 2440)
  ctx.lineTo(1456, 2440)
  ctx.strokeStyle = dividerColor
  ctx.lineWidth = 2
  ctx.stroke()

  // --- 5. Route section ---
  const depX = 872
  const arrX = 1288

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // FROM / TO labels
  ctx.font = '500 24px ABCRepro, system-ui, sans-serif'
  ctx.fillStyle = textTertiary
  ctx.fillText('FROM', depX, 2488)
  ctx.fillText('TO',   arrX, 2488)

  // IATA codes
  ctx.font = '400 120px ABCReproMono, monospace'
  ctx.fillStyle = textPrimary
  ctx.fillText(departureCode, depX, 2624)
  ctx.fillText(arrivalCode,   arrX, 2624)

  // Plane icon (SVG, rotated 90° clockwise to point right)
  if (planeImg) {
    const iconSize = 40
    ctx.save()
    ctx.translate(1080, 2592)
    ctx.rotate(Math.PI / 2)
    ctx.globalAlpha = 0.6
    ctx.drawImage(planeImg, -iconSize / 2, -iconSize / 2, iconSize, iconSize)
    ctx.globalAlpha = 1.0
    ctx.restore()
  }

  // City names
  ctx.font = '400 24px ABCRepro, system-ui, sans-serif'
  ctx.fillStyle = textSecondary
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(departureCity, depX, 2688)
  ctx.fillText(arrivalCity,   arrX, 2688)

  // Country names
  ctx.font = '400 24px ABCRepro, system-ui, sans-serif'
  ctx.fillStyle = textTertiary
  ctx.fillText(departureCountry, depX, 2720)
  ctx.fillText(arrivalCountry,   arrX, 2720)

  // --- 6. Date/time strip ---
  ctx.font = '400 24px ABCReproMono, monospace'
  ctx.fillStyle = isBWMode ? 'rgba(40, 40, 40, 0.4)' : 'rgba(255, 255, 255, 0.45)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${departureDateTime} ${departureTZ}`, depX, 2776)
  ctx.fillText(`${arrivalDateTime} ${arrivalTZ}`,     arrX, 2776)

  // --- 7. Export ---
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

function roundRectFallback(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y,     x + w, y + r,     r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x,     y + h, x,     y + h - r, r)
  ctx.lineTo(x,     y + r)
  ctx.arcTo(x,     y,     x + r, y,         r)
  ctx.closePath()
}
