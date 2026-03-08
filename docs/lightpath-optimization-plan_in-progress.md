# Lightpath — Performance Optimization Plan

**Version:** 0.9.3  
**Date:** March 2026  
**Scope:** Pre-release performance review and cleanup

---

## Summary

| # | Optimization | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | Pre-build progress tube, reveal via drawRange | Critical | ~45 min | ✅ Done (v0.9.0) |
| 2 | Eliminate per-frame Vector3/Matrix4 allocations | Critical | ~30 min | ✅ Done (v0.9.0) |
| 3 | Pre-allocate twilight boundary buffers | Medium | ~1.5 hours | Parked |
| 4 | Drive animation from rAF, not setInterval | Medium | ~1 hour | Parked |
| 5 | Fix keyboard useEffect dependency array | Medium | ~15 min | ✅ Done (v0.9.1) |
| 6 | Robustify URL auto-load (remove setTimeout) | Low | ~15 min | ✅ Done (v0.9.3) |
| 7 | Clean up dead code (unused fadeInterval vars) | Low | ~10 min | ✅ Done (v0.9.3) |
| 8 | Merge duplicate isBWMode useEffects | Low | ~10 min | ✅ Done (v0.9.3) |

**Bonus fix:** Collapsed panel ghost interaction — added `pointer-events: none` and `overflow: hidden` to `.flight-input.collapsed .panel-content` (v0.9.1).

**Bonus result:** URL auto-load fix (item 6) also resolved the "shareable URLs auto-load on visit" roadmap item — flights now load with the panel correctly collapsed when visiting a flight URL directly.

---

## Completed Items

### 1. Pre-build progress tube, reveal via drawRange (v0.9.0)

**Problem:** Every frame of the animation loop disposed the old progress tube, sampled 800 curve points, allocated a new Float32Array, constructed a new TubeGeometry (with Frenet frames, normals, UVs), created a new material, and added it to the scene. At 60fps, this was 60 full mesh constructions per second — the single most expensive operation in the render loop.

**Fix:** Pre-build the full-length tube at flight creation time with complete vertex color arrays for both color and BW modes. During animation, use `geometry.setDrawRange()` to progressively reveal vertices. Draw range operates on `geo.index.count` (triangle indices), not position count, to account for the tube's radial vertex structure.

**Result:** Per-frame tube cost went from ~3–8ms (geometry construction + GC) to effectively 0ms (single integer write). Tube segment count bumped from 800 to 1600 to maintain color gradient resolution at low progress values. Color interpolation from the old per-frame code is preserved in the pre-build step.

### 2. Eliminate per-frame Vector3/Matrix4 allocations (v0.9.0)

**Problem:** The animation loop created new `THREE.Vector3`, `THREE.Matrix4`, and `THREE.Quaternion` objects every frame for plane orientation and camera following — ~15–20 micro-allocations per frame, all immediately discarded.

**Fix:** Hoisted 16 scratch objects to the scope just above the `animate()` function. All per-frame math now uses `.copy()`, `.set()`, and `.crossVectors()` on these reusable objects instead of allocating new instances.

**Result:** Zero per-frame allocations in the plane/camera update path. Reduces GC pressure, especially noticeable on mobile.

### 3. Fix keyboard useEffect dependency array (v0.9.1)

**Problem:** The dependency array included `animationProgress`, causing the `keydown` listener to be torn down and re-added ~60 times per second during playback.

**Fix:** Replaced all direct state reads inside the handler with refs (`isPlayingRef`, `animationProgressRef`, `hasFlightPathRef`) and functional updaters (`prev => !prev`) for toggle setState calls. Dependency array reduced to `[]`.

### 4. Robustify URL auto-load (v0.9.3)

**Problem:** URL auto-load used `setTimeout(calculateFlight, 100)` to wait for React state to settle after setting departure/arrival. This was a race condition: React state updates are asynchronous, and 100ms is an arbitrary guess. On slow devices, `calculateFlight()` could fire before state had flushed, reading empty strings and silently failing.

**Fix:** Replaced with a `pendingUrlFlight` state flag. The URL useEffect sets all flight state and raises the flag. A separate useEffect watches for the flag plus all required state values, and only calls `calculateFlight()` once React has committed the updates. This also resolved the panel remaining open on URL auto-load.

### 5. Clean up dead code (v0.9.3)

Removed unused `fadeInterval` variables and their cleanup returns from the airport dots, graticule, and timezone useEffects. Removed unused `timezoneFadeIntervalRef` ref declaration.

### 6. Merge duplicate isBWMode useEffects (v0.9.3)

Merged two separate `[isBWMode]` useEffects into one. The ref sync, meta tag update, and BW color extraction now happen at the top of the single effect, before the scene animation logic. Eliminates a potential execution order issue.

---

## Parked Items

### 3. Pre-allocate twilight boundary buffers

**What:** `calculateTwilightBoundary` creates 361 `new THREE.Vector3` objects per call, called 8 times per frame (~2,888 allocations/frame). Replace with 8 pre-allocated `Float32Array` buffers that the function writes into directly.

**Why parked:** Lower impact than items 1–2. The twilight boundary update runs regardless of animation state, so it's a steady-state cost rather than a playback spike. Worth doing, but not blocking v1.0.

**Effort:** ~1.5 hours. Requires refactoring `calculateTwilightBoundary` to accept a target buffer parameter and write x/y/z directly instead of pushing Vector3 objects.

### 4. Drive animation from requestAnimationFrame

**What:** Replace the `setInterval` at 16ms for flight playback with delta-time-based progress advancement inside the existing `requestAnimationFrame` loop. Synchronizes progress with display refresh rate.

**Why parked:** After the drawRange fix, the animation loop is fast enough that the setInterval timing mismatch rarely causes visible stutter on current target devices. Would matter on 120Hz displays or very slow mobile devices.

**Effort:** ~1 hour. Requires adding refs for last playback timestamp and animation duration, computing delta inside `animate()`, and throttling React state updates to avoid 60fps re-renders of the slider UI.

---

## Architecture Notes

These optimizations did not change any visual output, user-facing behavior, or component API. The only observable differences are:

- **Tube tip appearance:** The drawRange reveal shows a flat cross-section at the tube tip instead of the old rounded TubeGeometry end cap. At radius 0.006 × elementScale, this is invisible, especially with the plane icon covering the tip.
- **URL auto-load:** Now works reliably on all devices and correctly collapses the panel — previously a roadmap item that was resolved as a side effect.
- **Color gradient resolution:** Bumped tube segments from 800 to 1600 to compensate for the loss of per-frame re-sampling at low progress values. Gradient quality is preserved.
