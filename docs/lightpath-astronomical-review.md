# Lightpath — Astronomical Calculations Review

**Date:** February 2026  
**Scope:** Review of all solar position, twilight, and daylight calculations in `App.jsx`  
**Version:** v0.5.4 (post Phase 1 cleanup)

---

## Libraries Used

| Library | Purpose | Basis |
|---|---|---|
| `solar-calculator` (Bostock) | Solar declination, Julian century conversion | NOAA equations |
| `suncalc` (Mourner) | Solar noon times, sunrise/sunset events | Jean Meeus algorithms |
| Custom GLSL shader | Twilight gradient on globe surface | Custom latitude-dependent model |
| Custom JS | Flight path sun angle, daylight stats | Spherical law of cosines |

---

## 1. Subsolar Longitude

**Location in code:** `updateSunPosition()`, `updateSunPositionForTime()`, `getSunAngle()`, `isPointInDaylight()`

**Method:**
```
SunCalc.getTimes(time, 0, 0) → solarNoon at equator/prime meridian
hoursSinceNoon = (currentTime - solarNoon) / 3600000
subsolarLongitude = -hoursSinceNoon × 15°
```

**Assessment: ✅ Correct**

SunCalc internally accounts for the Equation of Time (the ±15 minute correction caused by Earth's elliptical orbit and axial tilt). When it returns `solarNoon` for (0°N, 0°E), that time already includes the EoT correction. Computing the angular offset from there at 15°/hour is the standard approach.

Maximum theoretical error is under ~0.3° of longitude, which is imperceptible at the visualization's scale.

---

## 2. Solar Declination

**Location in code:** `calculateSolarDeclination()`

**Method:**
```javascript
const t = solar.century(date)   // Julian centuries since J2000.0
return solar.declination(t)      // NOAA declination in degrees
```

**Assessment: ✅ Excellent**

Uses `solar-calculator`'s full NOAA implementation with Julian century calculations. Accuracy is within a few arc-seconds. This is the same algorithm used by NOAA's online Solar Calculator.

---

## 3. Subsolar Point → 3D Direction Vector

**Location in code:** Initial setup (~line 577), `updateSunPosition()`, `updateSunPositionForTime()`

**Method:**
```javascript
phi   = (90 - subsolarLatitude) × (π / 180)     // colatitude
theta = (subsolarLongitude + 180) × (π / 180)   // adjusted longitude

sunDirection = Vector3(
  -sin(phi) × cos(theta),   // X
   cos(phi),                  // Y (up)
   sin(phi) × sin(theta)     // Z
)
```

**Assessment: ✅ Correct**

The coordinate convention (Y-up, negative X at 0° longitude, `+180` offset on theta) correctly matches the globe's texture orientation where the prime meridian faces the negative X direction.

---

## 4. Twilight Shader (Globe Overlay)

**Location in code:** Fragment shader in `twilightMaterial` (~line 614)

**Method:**
The shader computes for each surface fragment:
1. Angular distance from the sun direction (zenith angle)
2. A variable-width twilight zone based on observer latitude and solar declination
3. Darkness value with smoothstep transition and gamma correction

**Key parameters:**
- `baseTwilightAngle = 18.0` (astronomical twilight limit)
- Reduced by factor of `0.7` for visual compression → effective ~12.6° base
- `latitudeFactor = cos(absLatitude)` — wider twilight at higher latitudes
- `declinationFactor` — wider when sun declination differs from observer latitude
- `obliquityFactor = latitudeEffect × declinationFactor`
- Final width clamped to `[12°, 28°]`
- Transition uses `smoothstep` followed by `pow(darkness, 1.5)` gamma

**Assessment: ✅ Physically motivated, artistically tuned**

The latitude-dependent twilight width is a real physical phenomenon: at higher latitudes, the sun crosses the horizon at a more oblique angle, making twilight last longer. The shader captures this effect with a simplified model. The `0.7` factor and `clamp(12, 28)` are artistic choices for visual clarity, compressing the 18° astronomical range.

The `pow(darkness, 1.5)` gamma curve makes the daylit side slightly brighter and the dark onset sharper. In reality, twilight sky brightness drops roughly exponentially with solar depression angle, so a power curve is a fair perceptual approximation.

**Note:** This shader does not account for atmospheric refraction (~0.833°), which is negligible at the visualization's scale.

---

## 5. Twilight Boundary Lines

**Location in code:** `calculateTwilightBoundary()`, `updateTwilightLines()`

**Method:**
For each elevation angle (0°, −6°, −12°, −18°):
1. Compute a great circle at `(90° - elevation)` angular radius from the subsolar point
2. For non-terminator lines: apply a latitude-dependent obliquity adjustment

**Assessment: ⚠️ Approximate — intentional design choice**

The **terminator** (0° elevation) is computed correctly as a simple great circle at 90° from the subsolar point.

For **twilight lines** (civil at −6°, nautical at −12°, astronomical at −18°), the code applies a latitude-dependent "obliquity factor" that widens the boundary at higher latitudes. 

**Strictly speaking:** The instantaneous civil twilight boundary is the set of all points where the sun is exactly 6° below the horizon. This is a circle at a fixed angular radius of 96° from the subsolar point — it is *not* latitude-dependent. Where latitude matters is how *long* twilight lasts at a given location (angular speed of the sunset), not where the boundary is at any given instant.

**What the code does instead:** It makes the twilight boundaries appear wider at high latitudes, visually communicating "twilight lasts longer here." The `blendFactor = 0.2` means only 20% of the obliquity effect is applied, so the lines remain reasonably close to the astronomically correct circles.

**For strict astronomical accuracy:** Replace the obliquity-adjusted boundaries with simple great circles at 96°, 102°, and 108° from the subsolar point.

**For the current approach:** Visually intuitive and defensible as a design choice. The effect is subtle due to the reduced blend factor.

---

## 6. Flight Path Sun Angle

**Location in code:** `getSunAngle()` (inside flight path useEffect)

**Method:**
```javascript
// Compute subsolar point at the given time
// Compute angular distance between (lat, lon) and subsolar point
angularDistance = acos(
  sin(subsolarLat) × sin(pointLat) + 
  cos(subsolarLat) × cos(pointLat) × cos(Δlon)
) × (180/π)
```

**Assessment: ✅ Correct**

Standard spherical law of cosines for angular distance. This gives the solar zenith angle: 90° = sun on horizon, <90° = daylight, >90° = below horizon.

---

## 7. Flight Path Color Mapping

**Location in code:** Pre-calculated color arrays (~line 1343)

**Sun angle thresholds and their meaning:**

| Sun Angle | Astronomical Meaning | Color Mode Treatment |
|---|---|---|
| < 85° | Full daylight | Golden yellow |
| 85°–88° | Approaching horizon | Warm yellow → orange (sunset) or yellow → pink (sunrise) |
| 88°–91° | Near-horizon | Deep orange/pink |
| 91°–94° | Just below horizon (civil twilight begins) | Orange-red (sunset) or purple (sunrise) |
| 94°–97° | Mid civil twilight | Red-purple (sunset) or blue-purple (sunrise) |
| 97°–100° | Late civil / early nautical twilight | Dark purple → deep blue |
| 100°–108° | Nautical → astronomical twilight | Deep blue fade |
| > 108° | Full darkness | Very dark blue-black |

**Assessment: ✅ Well-constructed**

The gradient correctly differentiates between sunset (warmer, redder) and sunrise (cooler, more purple/blue), which is a nice touch that reflects the actual color temperature difference perceived by observers. The thresholds don't exactly match standard definitions (civil = 96°, nautical = 102°, astronomical = 108°) but the gradient is continuous, so the exact boundary positions matter less than the visual flow.

---

## 8. Daylight Statistics (`isPointInDaylight`)

**Location in code:** `isPointInDaylight()` (~line 2340), used in `calculateFlight()`

**Method:**
```javascript
return angularDistance < 95
```

**Assessment: ⚠️ Non-standard threshold**

The 95° cutoff places the day/night boundary 5° past the geometric horizon, which falls between:
- **90.0°** — geometric sunset (center of solar disk touches horizon)
- **90.833°** — official sunrise/sunset (NOAA standard, accounts for refraction + solar disk radius)
- **96.0°** — civil twilight boundary

This means the stats panel counts some civil twilight as "daylight." It's a reasonable middle ground but doesn't match any standard astronomical definition.

**Inconsistency:** The flight path coloring uses precise sun angles with smooth gradients (via `getSunAngle`), while the daylight/darkness time statistics use this simpler 95° binary cutoff. A user could see a colored path segment (e.g., sun at 93°, clearly in twilight gradient) while the stats count it as "daylight."

**Options for standardization:**
- Use **90.833°** to match official sunrise/sunset (NOAA standard)
- Use **96°** to match civil twilight (consistent with the transition detection, which uses `sunAngle < 96`)

---

## 9. Atmospheric Refraction

**Status:** Not accounted for in any calculation.

Near the horizon, atmospheric refraction lifts the apparent sun position by approximately 0.833°, which shifts the visible terminator by roughly 50–90 km toward the night side. NOAA uses a zenith angle of 90.833° as the true sunrise/sunset boundary.

**Impact:** At the visualization's scale (2-unit radius Earth), this offset is ~0.014 units — less than a pixel. Negligible for the globe visualization. Slightly more relevant for the daylight time statistics, where it could shift results by ~1–2 minutes on a typical flight.

---

## 10. Great Circle Flight Path

**Location in code:** Flight path useEffect (~line 1230)

**Method:** Spherical linear interpolation (slerp) between departure and arrival coordinates.

```javascript
a = sin((1 - fraction) × angle) / sin(angle)
b = sin(fraction × angle) / sin(angle)
point = a × start + b × end
```

**Assessment: ✅ Correct**

Standard slerp on unit vectors, producing a mathematically correct great circle path. The path is projected to a radius of 2.01 (slightly above the Earth surface) for visibility.

**Note:** Real flights don't follow exact great circles — they deviate for wind patterns, airspace restrictions, and jet stream optimization. The theoretical path is appropriate for a visualization focused on light conditions rather than actual routing.

---

## 11. Flight Duration Estimate

**Location in code:** `calculateFlight()` (~line 2499)

**Method:**
```javascript
cruiseSpeed = 750  // km/h
flightDurationHours = distance / cruiseSpeed
```

**Assessment: Reasonable approximation**

750 km/h is a sensible average ground speed for commercial aviation (typical cruise is ~850 km/h true airspeed, but effective ground speed varies with wind). Does not account for climb/descent phases, holding patterns, or wind. Adequate for a visualization tool.

---

## Summary Table

| Component | Accuracy | Risk Level | Notes |
|---|---|---|---|
| Subsolar longitude | ✅ Good | Low | SunCalc handles Equation of Time |
| Solar declination | ✅ Excellent | None | Full NOAA equations |
| 3D coordinate conversion | ✅ Correct | None | Matches globe orientation |
| Terminator position | ✅ Excellent | None | Standard great circle |
| Twilight shader gradient | ✅ Good | Low | Artistic latitude-width model |
| Twilight boundary lines | ⚠️ Approximate | Low | Obliquity adjustment is aesthetic, not strict |
| Flight path sun angle | ✅ Correct | None | Standard spherical law of cosines |
| Flight path coloring | ✅ Good | Low | Smooth gradient, sunset/sunrise differentiated |
| Daylight stats threshold | ⚠️ Non-standard | Medium | 95° doesn't match any standard definition |
| Atmospheric refraction | Not included | Very low | Negligible at visualization scale |
| Great circle path | ✅ Correct | None | Standard slerp |
| Flight duration | ~Approximate | Low | 750 km/h average, no wind correction |

---

## Potential Improvements (Post v1.0)

1. **Standardize daylight threshold** — Change `isPointInDaylight` from 95° to either 90.833° (official sunset) or 96° (civil twilight) for consistency with astronomical standards
2. **Simplify twilight lines** — Option to show strict astronomical boundaries (pure circles at 96°, 102°, 108°) vs. current latitude-adjusted visualization
3. **Atmospheric refraction** — Add 0.833° correction to terminator for "apparent" mode
4. **Subsolar point marker** — Visual indicator of where the sun is directly overhead (educational feature)
5. **Polar twilight phenomena** — Handle edge cases where twilight lines intersect or merge near the poles during solstices
