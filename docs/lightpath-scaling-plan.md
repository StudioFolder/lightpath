# Lightpath — Distance-Based Scaling Plan

**Date:** February 2026  
**Baseline version:** 0.6.15  
**Goal:** Smooth camera zoom and proportional element scaling for short flights

---

## The Problem

Currently, all flights render at the same visual scale regardless of distance. A 300 km flight (e.g., MXP–FCO) uses the same camera distance, tube thickness, label size, and plane icon as a 10,000 km flight (e.g., JFK–NRT). Short flights appear as a tiny line segment on the globe with labels that feel oversized relative to the route.

There is a single step at 500 km (`flightDistance < 500 ? 3.0 : 3.5`) that changes camera distance, but nothing else scales, and the transition is abrupt rather than smooth.

---

## The Solution

Introduce a continuous scale factor derived from flight distance. The camera zooms closer for shorter flights, and all visual elements scale proportionally so the flight fills a similar portion of the viewport regardless of distance.

---

## Scale Tiers

| Distance | Camera Radius | Scale Factor | Behavior |
|---|---|---|---|
| > 2,000 km | 3.5 | 1.0 | Default — current behavior, no changes |
| 1,000 – 2,000 km | 3.5 → 2.9 | 1.0 → 0.7 | Moderate zoom, elements shrink noticeably |
| 500 – 1,000 km | 2.9 → 2.5 | 0.7 → 0.5 | Close zoom, elements significantly smaller |
| < 500 km | 2.5 → 2.3 | 0.5 → 0.4 | Closest zoom, smallest elements |

**Interpolation:** Linear interpolation within each tier, producing a smooth continuous curve. No abrupt steps.

**Note:** These values are starting points. They will need visual tuning once implemented. The important thing is the architecture — making it easy to adjust the curve.

---

## What Needs to Scale

### Camera Distance
**Current:** Hardcoded `3.5` (or `3.0` for <500 km)  
**Location:** `centerCameraOnFlight()` in App.jsx  
**Change:** Replace hardcoded radius with `getFlightScale(flightDistance).cameraRadius`

**Also affected:** OrbitControls `minDistance` and `maxDistance` need to update to allow the closer zoom. Currently clamped at 3.0–3.5.

### Flight Path Tubes
| Element | Current Size | Scales With |
|---|---|---|
| Thin base tube | 0.002 radius | `scaleFactor` |
| Thick progress tube | 0.006 radius | `scaleFactor` |

**Location:** Flight path drawing useEffect and animation loop

### Labels & Sprites
| Element | Current Size | Scales With |
|---|---|---|
| Airport labels (desktop) | 0.16 × 0.06 | `scaleFactor` |
| Airport labels (mobile) | 0.22 × 0.08 | `scaleFactor` |
| Transition labels (desktop) | 0.20 × 0.07 | `scaleFactor` |
| Transition labels (mobile) | 0.28 × 0.10 | `scaleFactor` |

**Location:** `createTextLabel` in flight path drawing, and transition label `forEach`

### Plane Icon
**Current:** `0.04` desktop, `0.06` mobile  
**Location:** Scene setup (line ~457)  
**Note:** The plane geometry is created once at app init. For scaling, we can adjust `.scale.set()` rather than recreating the geometry.

### Airport Dots (on flight path)
**Current:** `SphereGeometry(0.01, 16, 16)`  
**Location:** Flight path drawing useEffect  
**Change:** Scale the radius by `scaleFactor`

### Transition Rings
**Current:** `TorusGeometry(0.008, 0.002, 8, 32)`  
**Location:** Flight path drawing useEffect  
**Change:** Scale both outer and inner radius

### Label Offset
**Current:** `0.075` offset distance (pushes label below the dot)  
**Location:** `createLabelWithOffset` in flight path drawing  
**Change:** Scale the offset distance

---

## Implementation Plan

### Step 1: Create scale utility function

Add to `geoUtils.js`:

```javascript
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
  
  if (d >= 2000) {
    return { cameraRadius: 3.5, scaleFactor: 1.0 }
  } else if (d >= 1000) {
    const t = (d - 1000) / 1000 // 0 at 1000km, 1 at 2000km
    return {
      cameraRadius: 2.9 + t * 0.6,
      scaleFactor: 0.7 + t * 0.3
    }
  } else if (d >= 500) {
    const t = (d - 500) / 500 // 0 at 500km, 1 at 1000km
    return {
      cameraRadius: 2.5 + t * 0.4,
      scaleFactor: 0.5 + t * 0.2
    }
  } else {
    const t = Math.max(0, (d - 200) / 300) // 0 at 200km, 1 at 500km
    return {
      cameraRadius: 2.3 + t * 0.2,
      scaleFactor: 0.4 + t * 0.1
    }
  }
}
```

### Step 2: Update `centerCameraOnFlight`

Replace the hardcoded `radius`:

```javascript
const { cameraRadius } = getFlightScale(flightDistance)
const radius = cameraRadius
```

Update OrbitControls distance limits before animating:

```javascript
controlsRef.current.minDistance = cameraRadius - 0.2
controlsRef.current.maxDistance = cameraRadius + 0.2
```

### Step 3: Store scale factor on the flight group

In the flight path drawing useEffect, compute and store the scale:

```javascript
const { scaleFactor } = getFlightScale(flightResults.distance)
flightGroup.userData.scaleFactor = scaleFactor
```

This makes the scale available to the animation loop without recalculating.

### Step 4: Apply scale to flight path elements

In the flight path drawing useEffect, replace hardcoded sizes:

```javascript
const { scaleFactor } = getFlightScale(flightResults.distance)

// Thin base tube
const thinTubeGeometry = new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(points),
  points.length,
  0.002 * scaleFactor,  // was 0.002
  8,
  false
)

// Airport dots
const dotGeometry = new THREE.SphereGeometry(0.01 * scaleFactor, 16, 16)

// Transition rings
const ringGeometry = new THREE.TorusGeometry(
  0.008 * scaleFactor,  // was 0.008
  0.002 * scaleFactor,  // was 0.002
  8, 32
)

// Transition label sprites
sprite.scale.set(
  (isMobile ? 0.28 : 0.20) * scaleFactor,
  (isMobile ? 0.10 : 0.07) * scaleFactor,
  1
)

// Airport label sprites (inside createTextLabel)
sprite.scale.set(
  (isMobile ? 0.22 : 0.16) * scaleFactor,
  (isMobile ? 0.08 : 0.06) * scaleFactor,
  1
)

// Label offset
const offset = offsetPos.clone().sub(basePos).normalize().multiplyScalar(0.075 * scaleFactor)
```

### Step 5: Apply scale to animated progress tube

In the animation loop, where the thick tube is created:

```javascript
const scaleFactor = flightLineRef.current?.userData.scaleFactor || 1.0

const thickGeometry = new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(completedPoints),
  Math.min(completedPoints.length * 2, 800),
  0.006 * scaleFactor,  // was 0.006
  8,
  false
)
```

### Step 6: Apply scale to plane icon

The plane geometry is created once at init, but we can scale it when a flight is calculated. In `calculateFlight()` or the flight path useEffect:

```javascript
const { scaleFactor } = getFlightScale(flightResults.distance)
if (planeIconRef.current) {
  planeIconRef.current.scale.set(scaleFactor, 1, scaleFactor)
}
```

**Note:** The plane mesh uses rotated PlaneGeometry. The scale axes may need testing to find which ones affect the visual size correctly.

### Step 7: Smooth camera transition

`centerCameraOnFlight` already uses slerp with easing for the camera movement. The only change is feeding it the distance-based radius instead of a hardcoded value. The smooth animation is already there.

### Step 8: Reset on new flight

When a new flight is calculated with a different distance, the scale changes. The camera will smoothly animate to the new position. OrbitControls limits need updating before the animation starts.

When the flight is cleared (user edits search), reset OrbitControls to default range:

```javascript
controlsRef.current.minDistance = 3.0
controlsRef.current.maxDistance = 3.5
```

---

## Testing Plan

### Test Routes by Distance Tier

| Route | Distance | Expected Behavior |
|---|---|---|
| JFK–NRT | ~10,800 km | No change from current (scaleFactor = 1.0) |
| JFK–LHR | ~5,500 km | No change (above 2,000 km threshold) |
| LHR–BCN | ~1,140 km | Moderate zoom, elements ~70% size |
| MXP–FCO | ~470 km | Close zoom, elements ~48% size |
| LCY–SEN | ~55 km | Closest zoom, elements ~40% size |

### Visual Checks
- [ ] Long flights (>2,000 km) look identical to current behavior
- [ ] Short flights fill the viewport proportionally
- [ ] Tube thickness feels proportional to the globe at every distance
- [ ] Labels are readable at all zoom levels
- [ ] Plane icon is visible but not oversized at close zoom
- [ ] Transition labels and rings are proportional
- [ ] Camera animation is smooth between different distance flights
- [ ] Switching from short to long flight smoothly zooms out
- [ ] BW mode still works correctly at all zoom levels
- [ ] Mobile scaling feels right at all distances
- [ ] Follow-plane mode works correctly with closer camera distances

### Edge Cases
- [ ] Same-airport flights (distance = 0) — should be prevented by UI
- [ ] Very short flights (<100 km) — ensure camera doesn't clip into globe
- [ ] Antipodal flights (~20,000 km) — should use default scale

---

## Tuning Notes

The scale values in `getFlightScale()` are initial estimates. After implementation, visual tuning will be needed:

1. **Camera radius range** — If 2.3 feels too close (globe fills too much of screen), increase the minimum. If 2.9 for medium flights doesn't feel zoomed enough, decrease it.
2. **Scale factor curve** — The linear interpolation within tiers may not feel right. Could switch to a single smooth curve: `scaleFactor = lerp(0.4, 1.0, smoothstep(500, 2000, distance))`.
3. **Element scaling ratios** — Not all elements may want to scale at the same rate. Labels might need to scale less aggressively (stay readable), while tubes scale more (stay proportional to globe surface). In that case, introduce `labelScale` and `pathScale` as separate multipliers.
4. **Mobile vs desktop** — Mobile may need different scale parameters since the screen is smaller and fingers are less precise.

---

## Commit Plan

| Version | What |
|---|---|
| v0.6.16 | Add `getFlightScale()` to geoUtils, update `centerCameraOnFlight` camera radius + OrbitControls |
| v0.6.17 | Apply scaleFactor to all flight path elements (tubes, dots, rings, labels) |
| v0.6.18 | Apply scaleFactor to animation loop (progress tube, plane icon) |
| v0.6.19 | Visual tuning pass — adjust curve values based on testing |
