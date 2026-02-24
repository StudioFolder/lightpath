# Lightpath — General Code Review (Second Pass)

**Date:** February 2026  
**Scope:** Full review of `App.jsx` for logic errors, edge cases, memory leaks, and runtime issues  
**Version:** v0.5.4 (post Phase 1 cleanup)

---

## Issues Found

### 🔴 Should Fix Before v1.0

#### 1. `transitionLabelsRef` Never Cleared on New Flight

**Location:** Flight path cleanup effect (~line 1149) and flight path creation (~line 1573)

**Problem:** When searching a new route, the cleanup effect removes the flight group from the scene and disposes geometries, but `transitionLabelsRef.current` (the array of sprite references) is never reset to `[]`. When the new flight path is created, new labels are `.push()`ed onto the stale array.

**Consequences:**
- Array grows with dead references to disposed sprites
- Animation loop iterates over dead labels unnecessarily
- BW mode toggle attempts to update textures on disposed materials (potential console errors)
- Memory leak: old sprite references are retained

**Fix:** Add `transitionLabelsRef.current = []` in the cleanup effect (around line 1176), and also at the start of the flight path creation effect (around line 1187).

---

#### 2. Line2 Material Resolution Not Updated on Window Resize

**Location:** Lines 1135–1140 (initialization) and line 1123 (`handleResize`)

**Problem:** The twilight line `LineMaterial` resolution is set once at initialization but never updated when the window is resized. `LineMaterial` requires its `resolution` uniform to match the current viewport size for correct line width rendering.

**Consequence:** After resizing the browser window, twilight boundary lines may render at incorrect widths (too thick or too thin).

**Fix:** Move the resolution update logic inside the `handleResize` function:
```javascript
function handleResize() {
  const width = window.innerWidth;
  const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  
  // Update Line2 materials resolution
  Object.values(twilightLinesRef.current).forEach(line => {
    if (line && line.material.resolution) {
      line.material.resolution.set(width, height)
    }
  })
}
```

---

#### 3. `visualViewport` Resize Listener Never Cleaned Up

**Location:** Line 1132 (add listener) and line 1144 (cleanup)

**Problem:** The code adds `window.visualViewport.addEventListener('resize', handleResize)` for mobile viewport handling, but the cleanup function only removes the `window` resize listener. The `visualViewport` listener leaks if the component unmounts.

**Fix:** Add to cleanup:
```javascript
return () => {
  window.removeEventListener('resize', handleResize)
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleResize)
  }
  renderer.dispose()
}
```

---

#### 4. URL Loading Uses `setTimeout` — Race Condition Risk

**Location:** Line 304

**Problem:** When loading a flight from URL parameters, the code calls multiple `setState` functions, then uses `setTimeout(calculateFlight, 100)` hoping React will have committed all state updates within 100ms. `calculateFlight` reads `departureCode`, `arrivalCode`, and `departureTime` from state, which may still hold stale values.

**Risk:** On slow devices or under heavy load, the state may not be committed in time, causing `calculateFlight` to use wrong or empty values.

**Better approach:** Use a separate `useEffect` that watches for all required values to be set:
```javascript
useEffect(() => {
  if (departureCode && arrivalCode && departureAirport && arrivalAirport) {
    calculateFlight()
  }
}, [departureCode, arrivalCode, departureAirport, arrivalAirport, departureTime])
```
Note: This needs careful design to avoid triggering on manual user interactions. One approach is a `loadedFromURL` ref flag.

---

#### 5. Pixel Ratio Uncapped on High-DPI Devices

**Location:** Line 409

**Problem:** `renderer.setPixelRatio(window.devicePixelRatio)` renders at full device pixel ratio. On Retina Macs (2×) and some phones (3×), this means rendering 4–9× as many pixels as needed for imperceptible quality gain.

**Impact:** Significant GPU load, especially on mobile. Can cause frame drops and battery drain.

**Fix:**
```javascript
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
```

---

### 🟡 Minor Issues

#### 6. `routePoints` Assigned Twice to `userData`

**Location:** Lines 1498 and 1577

**Problem:** `flightGroup.userData.routePoints = points` appears twice. Same value, harmless, but the duplicate at line 1577 should be removed.

---

#### 7. `autoRotate` State/Ref Sync Inconsistency

**Location:** `autoRotateRef` (line 111) vs other ref syncs (lines 310–316)

**Problem:** `followPlaneMode` and `isPlaying` have dedicated `useEffect`s to sync their refs. But `autoRotate`/`autoRotateRef` are only manually synced at line 2586. If `setAutoRotate` were ever called elsewhere without also setting the ref, the animation loop would use stale values.

**Current risk:** Low (only one call site), but inconsistent with the established pattern.

**Fix:** Add a sync effect alongside the others:
```javascript
useEffect(() => {
  autoRotateRef.current = autoRotate
}, [autoRotate])
```

---

#### 8. `isBWModeRef` Sync Located Far From Other Ref Syncs

**Location:** ~line 2703 (inside BW mode toggle effect) vs lines 310–316 (other ref syncs)

**Problem:** The ref sync pattern is scattered: some syncs are grouped at the top of the component, others are embedded deep in larger effects. Makes the sync logic harder to audit.

**Recommendation:** Consolidate all ref sync effects near the top of the component for readability.

---

#### 9. Mobile Detection Runs Duplicate Logic on Every Resize

**Location:** Lines 327–334

**Problem:** Two identical `if` blocks:
```javascript
if (isMobileDevice || (isTouchDevice && isSmallScreen)) {
  setFollowPlaneMode(true)
}
if (isMobileDevice || (isTouchDevice && isSmallScreen)) {
  setIsPanelCollapsed(true)
}
```

These can be merged into a single block. The calls are no-ops when the values haven't changed (React bails out on same-value updates), but the duplication is unnecessary.

---

#### 10. Stale Comment on Cruise Speed

**Location:** Line 2499

**Problem:** Comment says `// Estimate flight duration (average cruise speed ~850 km/h)` but the actual value is `const cruiseSpeed = 750`.

**Fix:** Update comment to match the code: `// Estimate flight duration (average ground speed ~750 km/h)`

---

## What Looks Correct ✅

| Area | Notes |
|---|---|
| Great circle path (slerp) | Correct, with proper `angle === 0` edge case handling |
| Flight path disposal | Thorough traversal disposing geometry, material, and textures |
| BW mode transition | Properly cross-fades all scene elements, swaps textures at midpoint |
| Keyboard shortcuts | Ignores input fields, correct dependency array |
| Airport search | Efficient priority-ordered matching (exact → prefix → city name) |
| Timezone lookups | Proper try/catch with UTC offset fallback |
| Animation progress | Correctly clamps to 1.0 and stops playback |
| Touch event handling | Properly prevents default, handles both mouse and touch on slider |
| Flight path color pre-calculation | Both color and BW arrays computed once, no per-frame allocation |
| Scene object lifecycle | Proper add/remove/dispose pattern throughout |

---

## Summary

| Priority | Count | Items |
|---|---|---|
| 🔴 Should fix | 5 | transitionLabelsRef leak, Line2 resize, visualViewport cleanup, URL race condition, pixel ratio cap |
| 🟡 Minor | 5 | Duplicate routePoints, autoRotate sync, isBWModeRef location, mobile detection merge, stale comment |
| ✅ Correct | 10 | Core rendering, disposal, interaction, and calculation logic |

The codebase is structurally sound. The issues found are edge cases and maintenance concerns rather than fundamental problems. The most impactful fix is the `transitionLabelsRef` memory leak (#1), followed by the pixel ratio cap (#5) for mobile performance.
