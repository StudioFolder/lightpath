# Lightpath — Phase 2: Utility Function Extraction Plan

**Date:** February 2026  
**Goal:** Extract repeated logic into shared utility files without changing any app behavior  
**Baseline version:** v0.6.11  
**Target version range:** v0.6.12 – v0.6.15, then v0.7.0 tag for the milestone

---

## Overview

Phase 2 creates a `src/utils/` folder with shared functions that replace duplicated code in App.jsx. Each step is an independent commit — the app works identically after each one.

**Files to create:**

```
src/
  utils/
    geoUtils.js         (Step 1)
    solarUtils.js       (Step 2)
    sceneUtils.js       (Step 3)
    animationUtils.js   (Step 4)
  App.jsx               (modified in each step)
```

**Estimated lines saved:** ~250–300 lines from App.jsx

---

## Step 1: `utils/geoUtils.js` — Geographic Coordinate Utilities

**Version:** v0.6.12  
**Risk:** Very low  
**Lines saved:** ~40 directly, plus consolidation of 6 inline coordinate conversions

### What to extract

The `latLonToVector3` function is defined 4 separate times in App.jsx with identical logic (the same phi/theta/Vector3 formula). Two additional places do the same math inline without a function call. All use the same coordinate convention.

### Current locations

| Location | Signature | Used by |
|---|---|---|
| ~line 1217 | `latLonToVector3(lat, lon, radius)` | Flight path drawing (departure/arrival dots, label positioning) |
| ~line 1732 | Inline (same math, no function) | Airport dots rendering |
| ~line 1828 | `latLonToVector3(lon, lat, radius)` ⚠️ | Graticule GeoJSON (params swapped!) |
| ~line 1955 | `latLonToVector3(lon, lat, radius)` ⚠️ | Timezone GeoJSON (params swapped!) |
| ~line 519 | Inline (same math, sets position directly) | User location dot |
| ~line 531 | Inline (same math, sets camera position) | Camera centering |

### ⚠️ Important: Parameter order difference

The graticule and timezone versions swap the parameter order to `(lon, lat, radius)` because GeoJSON coordinates are `[longitude, latitude]`. The shared function should use the standard `(lat, lon, radius)` signature, and the GeoJSON call sites should swap the arguments: `latLonToVector3(coord[1], coord[0], radius)`.

### New file: `src/utils/geoUtils.js`

```javascript
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
```

### Changes to App.jsx

1. Add import at the top: `import { latLonToVector3 } from './utils/geoUtils'`

2. **Delete** the 4 local function definitions of `latLonToVector3` (~lines 1217, 1828, 1955, and the one in the flight path effect)

3. **Replace inline conversions:**

   **Airport dots** (~line 1732): Replace the inline phi/theta/xyz math with:
   ```javascript
   const pos = latLonToVector3(airport.lat, airport.lon, 2.005)
   positions.push(pos.x, pos.y, pos.z)
   ```

   **User location dot** (`positionDotAtLocation`, ~line 519): Replace with:
   ```javascript
   function positionDotAtLocation(lat, lon) {
     const pos = latLonToVector3(lat, lon, 2)
     dot.position.copy(pos)
   }
   ```

   **Camera centering** (`centerCameraOnLocation`, ~line 530): Replace with:
   ```javascript
   function centerCameraOnLocation(lat, lon) {
     const pos = latLonToVector3(lat, lon, 5)
     camera.position.copy(pos)
     camera.lookAt(0, 0, 0)
     controls.update()
   }
   ```

   **Camera flight centering** (`centerCameraOnFlight`, ~line 2397): Replace the phi/theta/basePosition block with:
   ```javascript
   const basePosition = latLonToVector3(midLat, midLon, radius)
   ```

4. **Fix GeoJSON call sites** — swap argument order:

   **Graticule** (~line 1844):
   ```javascript
   // Before: latLonToVector3(coord[0], coord[1], 2.004)
   // After:
   latLonToVector3(coord[1], coord[0], 2.004)
   ```
   Apply this to all graticule coordinate calls (both LineString and MultiLineString).

   **Timezones** (~line 1973):
   ```javascript
   // Before: latLonToVector3(coord[0], coord[1], 2.005)
   // After:
   latLonToVector3(coord[1], coord[0], 2.005)
   ```
   Apply this to all timezone coordinate calls (both Polygon and MultiPolygon).

### Testing checklist
- [ ] Globe renders correctly (user dot in right place)
- [ ] Flight path draws between correct airports
- [ ] Airport dots appear in correct locations
- [ ] Graticule lines follow lat/lon grid correctly
- [ ] Timezone boundaries display correctly
- [ ] Camera centers on flight midpoint correctly

---

## Step 2: `utils/solarUtils.js` — Solar Position Calculations

**Version:** v0.6.13  
**Risk:** Low  
**Lines saved:** ~60

### What to extract

The subsolar point calculation (longitude via SunCalc + latitude via solar declination) is repeated 5 times with identical logic. The sun angle and daylight check functions are also duplicated.

### Current locations

| Function | Occurrences | Lines |
|---|---|---|
| Subsolar point (lon + lat) | 5× | ~568, ~770, ~801, ~1277, ~2344 |
| `calculateSolarDeclination` | 1 definition, 7 calls | ~136 |
| `getSunAngle(lat, lon, time)` | 1× (inside useEffect) | ~1276 |
| `isPointInDaylight(lat, lon, time)` | 1× (component scope) | ~2340 |

### New file: `src/utils/solarUtils.js`

```javascript
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
```

### Changes to App.jsx

1. Add import: `import { calculateSolarDeclination, getSubsolarPoint, getSunAngle, isPointInDaylight } from './utils/solarUtils'`

2. **Delete** from App.jsx:
   - The `calculateSolarDeclination` function definition (~line 136)
   - The `getSunAngle` function inside the flight path useEffect (~line 1276)
   - The `isPointInDaylight` function (~line 2340)

3. **Replace subsolar point patterns.** Everywhere you see this 5-line pattern:
   ```javascript
   const times = SunCalc.getTimes(time, 0, 0)
   const solarNoon = times.solarNoon
   const hoursSinceNoon = (time - solarNoon) / (1000 * 60 * 60)
   const subsolarLongitude = -hoursSinceNoon * 15
   const subsolarLatitude = calculateSolarDeclination(time)
   ```
   Replace with:
   ```javascript
   const subsolar = getSubsolarPoint(time)
   const subsolarLongitude = subsolar.longitude
   const subsolarLatitude = subsolar.latitude
   ```
   
   Or for the variant that uses `sunDeclination`:
   ```javascript
   const subsolar = getSubsolarPoint(currentTime)
   const subsolarLongitude = subsolar.longitude
   const sunDeclination = subsolar.latitude
   ```

   Locations to update:
   - Initial setup (~line 568)
   - `updateSunPosition()` (~line 770)
   - `updateSunPositionForTime()` (~line 801)
   - `getSunAngle` inside flight path effect (~line 1277) — this entire function is replaced by the import
   - `isPointInDaylight` (~line 2344) — this entire function is replaced by the import

4. **Remove unused imports** from App.jsx if `SunCalc` and `solar` are no longer used directly (check that `calculateTwilightBoundary` still calls `calculateSolarDeclination` — it does, but that will now come from the import). `SunCalc` may still be needed if it's used elsewhere (e.g., the twilight boundary function calls it via `calculateSolarDeclination` which is now imported).

   **Check:** After removing the direct definitions, grep for any remaining direct uses of `SunCalc` or `solar` in App.jsx. If they only appear in the imported functions, remove the imports from App.jsx.

### Testing checklist
- [ ] Day/night terminator appears in correct position
- [ ] Terminator moves correctly in real-time
- [ ] Flight animation updates sun position during playback
- [ ] Flight path coloring (day/twilight/night gradients) is correct
- [ ] Flight stats (daylight/darkness hours) are correct
- [ ] Twilight boundary lines are positioned correctly
- [ ] Twilight shader gradient matches the boundary lines

---

## Step 3: `utils/sceneUtils.js` — Three.js Label & Texture Helpers

**Version:** v0.6.14  
**Risk:** Medium (canvas drawing is pixel-sensitive)  
**Lines saved:** ~120

### What to extract

The airport label canvas drawing code is duplicated between initial creation and BW mode swap. The transition label canvas drawing has the same duplication. Both follow the pattern: create canvas → draw rounded rect → draw icon → draw text → create texture.

### Current locations

| Function | Initial Creation | BW Mode Swap |
|---|---|---|
| Airport labels (departure/arrival) | `createTextLabel` (~line 1594) | `createLabelTexture` (~line 2754) |
| Transition labels (sunrise/sunset) | Inside `preCalculatedTransitions.forEach` (~line 1520) | Inside BW mode effect (~line 2946) |

### New file: `src/utils/sceneUtils.js`

```javascript
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
 * Returns via callback once the icon loads.
 * 
 * @param {string} timeText - Display time (e.g., "2h 15m")
 * @param {string} transitionType - 'sunrise' or 'sunset'
 * @param {boolean} isBW - Whether to use BW mode colors
 * @param {function} callback - Called with the created THREE.CanvasTexture
 */
export function createTransitionLabelTexture(timeText, transitionType, isBW, callback) {
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

    callback(new THREE.CanvasTexture(canvas))
  }
  icon.src = iconSrc
}
```

### Changes to App.jsx

1. Add import: `import { createAirportLabelTexture, createTransitionLabelTexture } from './utils/sceneUtils'`

2. **Replace `createTextLabel`** (~line 1594): Delete the function and replace calls with `createAirportLabelTexture(code, iconSrc, isBWModeRef.current)`

3. **Replace `createLabelTexture`** in BW mode effect (~line 2754): Delete the function and replace calls with `createAirportLabelTexture(code, iconSrc, isBWMode)`

4. **Replace transition label canvas drawing** in both:
   - Initial creation (~line 1536): Replace the `icon.onload` block with:
     ```javascript
     createTransitionLabelTexture(trans.time, trans.type, isBWMode, (texture) => {
       sprite.material.map = texture
       sprite.material.needsUpdate = true
     })
     ```
   - BW mode swap (~line 2958): Replace with:
     ```javascript
     createTransitionLabelTexture(timeText, transitionType, isBWMode, (texture) => {
       label.material.map.dispose()
       label.material.map = texture
       label.material.needsUpdate = true
     })
     ```

### ⚠️ Careful with this step

The canvas drawing code is pixel-sensitive. After making these changes, test thoroughly:

### Testing checklist
- [ ] Departure and arrival labels render correctly (icon + text aligned)
- [ ] Transition labels (sunrise/sunset) render correctly
- [ ] BW mode toggle swaps all labels correctly
- [ ] Icon alignment matches in both color and BW modes
- [ ] Labels appear at correct positions on the globe
- [ ] No console errors about disposed textures

---

## Step 4: `utils/animationUtils.js` — Fade Animation Helpers

**Version:** v0.6.15  
**Risk:** Low-medium  
**Lines saved:** ~80

### What to extract

The fade-in/fade-out pattern using `setInterval` is repeated for airports, graticule, timezones, and twilight lines. Each follows the same structure:

```javascript
let opacity = startValue
const fade = setInterval(() => {
  opacity += step  // or -= for fade out
  if (opacity >= target) {  // or <= for fade out
    opacity = target
    clearInterval(fade)
    // optional: remove/dispose on fade out complete
  }
  material.opacity = opacity
}, 20)
```

### Current locations

| Element | Fade Out | Fade In | Lines |
|---|---|---|---|
| Airport dots | ~1711 | ~1773 | ~40 |
| Graticule | ~1798 | ~1883 | ~50 |
| Twilight lines | ~1924 | ~2106 | ~60 |
| Timezone boundaries | Similar pattern | Similar pattern | ~50 |

### New file: `src/utils/animationUtils.js`

```javascript
/**
 * Fade a Three.js material's opacity from current value to a target.
 * 
 * @param {THREE.Material} material - Material to animate
 * @param {number} targetOpacity - Target opacity (0 to 1)
 * @param {Object} options
 * @param {number} options.step - Opacity change per tick (default: 0.02)
 * @param {number} options.interval - Milliseconds between ticks (default: 20)
 * @param {function} options.onComplete - Called when fade completes
 * @returns {number} Interval ID (for cleanup with clearInterval)
 */
export function fadeMaterial(material, targetOpacity, options = {}) {
  const { step = 0.02, interval = 20, onComplete } = options
  const direction = targetOpacity > material.opacity ? 1 : -1

  const fadeInterval = setInterval(() => {
    material.opacity += step * direction
    
    const done = direction > 0 
      ? material.opacity >= targetOpacity
      : material.opacity <= targetOpacity

    if (done) {
      material.opacity = targetOpacity
      clearInterval(fadeInterval)
      if (onComplete) onComplete()
    }
  }, interval)

  return fadeInterval
}

/**
 * Fade all materials in a Three.js group's children.
 * 
 * @param {THREE.Group} group - Group containing meshes/lines to fade
 * @param {number} targetOpacity - Target opacity
 * @param {Object} options - Same as fadeMaterial options
 * @returns {number} Interval ID
 */
export function fadeGroup(group, targetOpacity, options = {}) {
  const { step = 0.02, interval = 20, onComplete, maxOpacity } = options
  const direction = targetOpacity > 0 ? 1 : -1
  let opacity = direction > 0 ? 0 : group.children[0]?.material?.opacity || 1

  const fadeInterval = setInterval(() => {
    opacity += step * direction
    
    const done = direction > 0 
      ? opacity >= targetOpacity
      : opacity <= targetOpacity

    if (done) {
      opacity = targetOpacity
      clearInterval(fadeInterval)
      if (onComplete) onComplete()
    }

    group.traverse((child) => {
      if (child.material) {
        const clampedOpacity = maxOpacity ? Math.min(opacity, maxOpacity) : opacity
        child.material.opacity = clampedOpacity
      }
    })
  }, interval)

  return fadeInterval
}
```

### Changes to App.jsx

This step requires the most careful replacement since each fade has slightly different behavior (different target opacities, some dispose on complete, some traverse children). The shared functions handle the common pattern, but each call site may need different `options`.

Example replacement for airport dots fade-out:
```javascript
// Before (~30 lines of manual setInterval)
// After:
fadeMaterial(material, 0, {
  onComplete: () => {
    sceneRef.current.remove(existingDots)
    existingDots.geometry.dispose()
    material.dispose()
  }
})
```

Example for airport dots fade-in:
```javascript
// Before (~10 lines)
// After:
fadeMaterial(material, 0.8)
```

### ⚠️ Note on this step

The fade patterns are similar but not identical — some fade group children, some fade a single material, some have special clamping (timezone lines capped at 0.9). The utility functions provide the 80% common case; a few call sites may need small adjustments to the options.

### Testing checklist
- [ ] Airport dots fade in/out smoothly when toggled
- [ ] Graticule fades in/out smoothly when toggled
- [ ] Timezone boundaries fade in/out smoothly
- [ ] Twilight lines fade in/out smoothly
- [ ] No lingering intervals (check cleanup returns)
- [ ] Mutual exclusivity still works (graticule/timezone toggle)

---

## After All Steps: v0.7.0 Milestone

Once all four steps are complete and tested:

```
git add .
git commit -m "v0.7.0: Phase 2 complete — utility functions extracted, codebase modularized"
git tag v0.7.0
git push && git push --tags
```

### Final structure

```
src/
  utils/
    geoUtils.js         (~15 lines)
    solarUtils.js       (~65 lines)  
    sceneUtils.js       (~95 lines)
    animationUtils.js   (~55 lines)
  App.jsx               (~3,450 lines, down from ~3,744)
  App.css               (unchanged)
```

### What Phase 2 achieves
- **Single source of truth** for coordinate conversion, solar calculations, label creation, fade animations
- **Testable units** — utility functions can be unit tested independently in the future
- **Cleaner App.jsx** — ~300 fewer lines, easier to navigate
- **Foundation for Phase 3** — component extraction becomes much simpler with utilities already shared
- **Foundation for scaling features** — distance-based zoom/scale can be added to geoUtils and sceneUtils centrally
