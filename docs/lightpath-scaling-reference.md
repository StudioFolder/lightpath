# Lightpath — Scaling Behaviour Reference

**Implemented:** March 2026  
**Versions:** v0.6.16 – v0.6.20  
**Baseline:** v0.6.15 (pre-scaling)

---

## Overview

Lightpath uses two independent scaling systems that compose together to control the visual size of 3D elements:

1. **Distance-based scaling** — Adjusts element sizes and camera zoom based on flight distance, so short flights fill the viewport proportionally rather than appearing as tiny lines with oversized labels.

2. **Viewport-based scaling** — Caps element sizes on screens wider than 1440px, preventing labels, tubes, and icons from growing disproportionately large compared to fixed-size HTML UI elements.

Both systems produce a multiplier between 0 and 1. The final size of any element is:

```
finalSize = baseSize × scaleFactor × viewportScale
```

This combined value is stored as `elementScale` and used throughout the flight path drawing and animation code.

---

## Utility Functions (geoUtils.js)

### `getFlightScale(distanceKm)`

Returns `{ cameraRadius, scaleFactor }` based on flight distance. Uses four tiers with linear interpolation within each tier, producing a smooth continuous curve.

**Scale Tiers:**

| Distance | Camera Radius | Raw Scale Factor | Behavior |
|---|---|---|---|
| ≥ 2,000 km | 3.5 | 1.0 | Default — no scaling |
| 1,000 – 2,000 km | 2.9 → 3.5 | 0.7 → 1.0 | Moderate zoom and shrink |
| 500 – 1,000 km | 2.5 → 2.9 | 0.5 → 0.7 | Close zoom, significant shrink |
| 200 – 500 km | 2.3 → 2.5 | 0.4 → 0.5 | Closest zoom, smallest elements |

**Minimum distance floor:** 200 km. Flights shorter than 200 km use the same scale as 200 km to prevent elements from becoming invisibly small or the camera clipping into the globe.

**Camera compensation:** The raw `scaleFactor` from the tier table is further multiplied by `cameraRadius / 3.5` to compensate for the closer camera making elements appear larger on screen. Without this, a short flight's elements would appear roughly the same screen size as a long flight's elements despite the intended shrink, because the camera proximity cancels out the size reduction.

**Example values with camera compensation:**

| Route | Distance | Camera Radius | Raw Scale | Camera Comp. | Final scaleFactor |
|---|---|---|---|---|---|
| JFK–NRT | ~10,800 km | 3.5 | 1.0 | 1.0 | 1.0 |
| JFK–LHR | ~5,500 km | 3.5 | 1.0 | 1.0 | 1.0 |
| LHR–BCN | ~1,140 km | 2.98 | 0.74 | 0.85 | 0.63 |
| MXP–FCO | ~470 km | 2.41 | 0.49 | 0.69 | 0.34 |
| LCY–SEN | ~55 km | 2.3 | 0.4 | 0.66 | 0.26 |

### `getViewportScale(windowWidth, referenceWidth = 1440)`

Returns `Math.min(1.0, referenceWidth / windowWidth)`.

- Window ≤ 1440px → returns 1.0 (no change)
- Window 1920px → returns 0.75
- Window 2560px → returns 0.5625

This prevents 3D elements from growing with window width while HTML UI elements stay fixed. The globe itself still scales with the viewport (which is correct — it should fill the screen), but labels, tubes, dots, rings, and the plane icon are capped.

---

## Where Scaling Is Applied

### elementScale Computation

In the **flight path drawing useEffect**, before any flight elements are created:

```javascript
const { scaleFactor } = getFlightScale(flightResults.distance)
const vScale = viewportScaleRef.current
const elementScale = scaleFactor * vScale
```

Both values are stored on the flight group for access in the animation loop:

```javascript
flightGroup.userData.scaleFactor = scaleFactor
flightGroup.userData.elementScale = elementScale
```

### Static Flight Path Elements (flight path drawing useEffect)

| Element | Base Size | Scaled Size | Location |
|---|---|---|---|
| Thin base tube radius | 0.002 | `0.002 * elementScale` | TubeGeometry creation |
| Airport dots radius | 0.01 | `0.01 * elementScale` | SphereGeometry creation |
| Transition ring outer radius | 0.008 | `0.008 * elementScale` | TorusGeometry creation |
| Transition ring tube radius | 0.002 | `0.002 * elementScale` | TorusGeometry creation |
| Airport label sprite (desktop) | 0.16 × 0.06 | `× elementScale` | createTextLabel |
| Airport label sprite (mobile) | 0.22 × 0.08 | `× elementScale` | createTextLabel |
| Transition label sprite (desktop) | 0.20 × 0.07 | `× elementScale` | forEach loop |
| Transition label sprite (mobile) | 0.28 × 0.10 | `× elementScale` | forEach loop |
| Airport label offset distance | 0.075 | `0.075 * elementScale` | createLabelWithOffset |

### Animated Elements (animation loop)

These read `elementScale` from `flightLineRef.current.userData.elementScale`:

| Element | Base Size | Scaled Size | Location |
|---|---|---|---|
| Thick progress tube radius | 0.006 | `0.006 * eScale` | Animation loop, TubeGeometry |
| Transition label offset from path | 0.06 | `0.06 * eScale` | Animation loop, label positioning |
| Plane surface offset | 0.02 | `0.02 * eScale` | Animation loop, plane positioning |
| Plane forward offset | 0.035 | `0.035 * eScale` | Animation loop, plane positioning |

### Plane Icon Scale

Applied in `calculateFlight()` after the flight is computed:

```javascript
const { scaleFactor } = getFlightScale(distance)
const planeScale = scaleFactor * viewportScaleRef.current
if (planeIconRef.current) {
  planeIconRef.current.scale.set(planeScale, 1, planeScale)
}
```

The plane mesh geometry has `rotateX(Math.PI / 2)`, so X and Z are the visible dimensions. Y (value 1) is the flat axis perpendicular to the visible face.

### Camera Tilt

The south tilt in `centerCameraOnFlight` scales with `scaleFactor` to prevent short flights from being pushed too far north of viewport centre:

```javascript
const { scaleFactor } = getFlightScale(flightDistance)
const tiltAngle = (10 * scaleFactor) * Math.PI / 180
```

- Long flights (≥ 2,000 km): full 10° south tilt
- Short flights: proportionally reduced (e.g. ~3.4° at 470 km)

---

## Camera Transition System

### Smooth Zoom Animation

`centerCameraOnFlight` animates both the camera's **angular position** (slerp) and **distance from origin** (lerp) simultaneously over 1500ms with ease-in-out.

```javascript
const startRadius = camera.position.length()
// ...
const currentRadius = startRadius + (radius - startRadius) * eased
```

### OrbitControls During Transitions

OrbitControls enforces `minDistance`/`maxDistance` on every `controls.update()` call, which runs every frame in the animation loop. To prevent clamping during the transition:

1. **Before animation starts:** Limits are widened to encompass both start and target distances
   ```javascript
   controls.minDistance = Math.min(startRadius, radius) - 0.2
   controls.maxDistance = Math.max(startRadius, radius) + 0.2
   ```

2. **After animation completes:** Limits are tightened to the target distance
   ```javascript
   controls.minDistance = radius - 0.2
   controls.maxDistance = radius + 0.2
   ```

3. **When flight is cleared** (cleanup useEffect on `[departureSearch, arrivalSearch]`): Limits reset to defaults
   ```javascript
   controls.minDistance = 3.0
   controls.maxDistance = 3.5
   ```

---

## Viewport Height Lock

To prevent the globe from shrinking when the mobile keyboard appears (which reduces viewport height), the resize handler locks the renderer to the tallest height the window has ever been:

```javascript
const initialHeight = camera.userData.initialHeight || height
const renderHeight = Math.max(height, initialHeight)
camera.aspect = width / renderHeight
renderer.setSize(width, renderHeight)
```

`camera.userData.initialHeight` is set once during scene initialization. When the keyboard appears and height decreases, the canvas maintains its original size and the browser clips the bottom. When the keyboard dismisses, the canvas returns to normal.

This is independent of both scaling systems and has no interaction with `elementScale` or `viewportScale`.

---

## viewportScaleRef Lifecycle

- **Initialized:** At ref declaration, using current `window.innerWidth`
  ```javascript
  const viewportScaleRef = useRef(getViewportScale(window.innerWidth))
  ```
- **Updated:** In the resize handler on every window resize
  ```javascript
  viewportScaleRef.current = getViewportScale(width)
  ```
- **Read:** In the flight path drawing useEffect (for static elements) and in `calculateFlight()` (for plane icon scale)
- **Note:** Elements created before a resize will use the old value. The thick progress tube and plane offsets read from `flightGroup.userData.elementScale`, which is set at flight draw time and not updated on resize. A full re-render (recalculating the flight) would pick up the new value.

---

## What Does NOT Scale

| Element | Reason |
|---|---|
| Globe (Earth sphere) | Should fill viewport naturally with camera distance |
| Twilight shader sphere | Tied to globe surface |
| Atmospheric glow | Tied to globe surface |
| Twilight boundary lines | Global features, not flight-specific |
| Graticule lines | Global features, not flight-specific |
| Timezone boundaries | Global features, not flight-specific |
| User location dot | Has its own camera-distance compensation (`currentDistance / baseDistance × viewportScale`) independent of flight scaling |
| HTML UI elements | Fixed CSS sizing, unaffected by Three.js scaling |

---

## Tuning Guide

### Adjusting the Scale Curve

All tier values are in `getFlightScale()` in geoUtils.js. To make elements smaller at a given distance, reduce the `scaleFactor` value for that tier. To zoom the camera closer, reduce the `cameraRadius` value.

The camera compensation (`scaleFactor *= cameraRadius / 3.5`) automatically adjusts when you change camera radius values, so modifying `cameraRadius` alone won't change apparent element sizes — you need to adjust `scaleFactor` independently.

**Alternative curve shapes:** The current implementation uses linear interpolation within each tier. For a smoother single curve, replace the tier system with:

```javascript
// Example: single smooth curve using smoothstep
const t = Math.max(0, Math.min(1, (d - 500) / 1500))
const smooth = t * t * (3 - 2 * t) // smoothstep
scaleFactor = 0.4 + 0.6 * smooth
```

### Adjusting the Viewport Reference Width

Change the default parameter in `getViewportScale()`. A smaller reference width (e.g. 1280) would start capping earlier. A larger value (e.g. 1920) would allow more growth before capping.

### Adjusting Individual Element Rates

If specific elements need to scale differently (e.g. labels should stay more readable while tubes shrink more), introduce separate multipliers:

```javascript
const labelScale = Math.max(elementScale, 0.6) // labels never below 60%
const pathScale = elementScale                   // tubes scale fully
```

This pattern is already applicable — just replace `elementScale` with the appropriate sub-scale where needed.

### Minimum Size Floors

For elements that become invisible at small scales (e.g. transition rings), apply a floor:

```javascript
const ringScale = Math.max(elementScale, 0.6)
```

---

## Version History

| Version | Changes |
|---|---|
| v0.6.16 | Added `getFlightScale()` and `getViewportScale()` to geoUtils.js. Updated `centerCameraOnFlight` with distance-based camera radius and smooth zoom transitions. OrbitControls limits widen during animation and tighten after. Reset limits on flight cleanup. |
| v0.6.17 | Prevent globe shrinking when mobile keyboard appears — resize handler locks renderer to maximum historical height. |
| v0.6.18 | Applied `elementScale` to all static flight path elements: thin tube, airport dots, transition rings, transition label sprites, airport label sprites, label offset distance. |
| v0.6.19 | Applied scaling to animation loop elements: thick progress tube, plane icon size and offsets, transition label offset from path. Scaled camera south tilt proportionally to flight distance. |
| v0.6.20 | Clean up redundant OrbitControls widening. Add scaling reference documentation. |
