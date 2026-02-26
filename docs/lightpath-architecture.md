# Lightpath — Application Architecture

**Version:** 0.6.15  
**Last updated:** February 2026  
**Repository:** StudioFolder/lightpath on GitHub  
**Deployment:** Vercel (automatic pipeline)

---

## What Lightpath Does

Lightpath is a 3D flight path visualization that shows how aviation routes intersect with Earth's day/night cycle. It renders an interactive globe with accurate solar illumination, plots great circle flight paths color-coded by daylight/twilight/darkness, and animates flights through time showing how sun exposure changes throughout the journey.

**Target audiences:** Data visualization community, aviation enthusiasts, general public.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | React 19.2 | UI rendering, state management |
| 3D Engine | Three.js 0.182 | Globe, flight paths, labels, shaders |
| Build | Vite 7.2 | Dev server, production builds |
| Routing | react-router-dom 7.12 | Shareable flight URLs |
| Astronomy | solar-calculator 0.3 (NOAA) | Solar declination (full Julian century) |
| Astronomy | suncalc 1.9 (Jean Meeus) | Solar noon, sunrise/sunset events |
| Timezones | tz-lookup 6.1, Luxon 3.7 | Coordinate-to-timezone, formatting |
| Content | react-markdown 10.1 | About/Data panel markdown rendering |

---

## File Structure

```
src/
├── App.jsx              (3,443 lines — main component)
├── App.css              (2,352 lines — all styles)
├── utils/
│   ├── geoUtils.js      (21 lines — coordinate conversion)
│   ├── solarUtils.js    (69 lines — solar position calculations)
│   ├── sceneUtils.js    (106 lines — label texture creation)
│   └── animationUtils.js (38 lines — fade animations)
public/
├── earth-texture.png    (custom Earth texture, created in QGIS)
├── graticule-10.geojson (10° latitude/longitude grid)
├── timezones.geojson    (timezone boundaries)
├── plane-icon.svg / plane-icon-bw.svg
├── departure-icon.svg / departure-icon-bw.svg
├── arrival-icon.svg / arrival-icon-bw.svg
├── sunrise-icon.svg / sunrise-icon-bw.svg
├── sunset-icon.svg / sunset-icon-bw.svg
├── about.md / data.md   (info panel content)
```

---

## Utility Modules

### `geoUtils.js`
- **`latLonToVector3(lat, lon, radius)`** → `THREE.Vector3`
  Converts geographic coordinates to 3D position on the globe. Single source of truth for the app's coordinate convention (Y-up, negative X at 0° longitude, +180° theta offset).

### `solarUtils.js`
- **`calculateSolarDeclination(date)`** → degrees
  Full NOAA equations via solar-calculator. Returns latitude where sun is directly overhead (-23.44° to +23.44°).
- **`getSubsolarPoint(time)`** → `{ latitude, longitude }`
  Combines SunCalc (Equation of Time for longitude) with declination (for latitude). This is the point on Earth directly under the sun.
- **`getSunAngle(lat, lon, time)`** → degrees
  Spherical law of cosines: angular distance between a surface point and the subsolar point. <90° = daylight, 90° = horizon, >90° = night.
- **`isPointInDaylight(lat, lon, time)`** → boolean
  Returns true if sun angle < 95° (between geometric sunset at 90° and civil twilight at 96°).

### `sceneUtils.js`
- **`createAirportLabelTexture(code, iconSrc, isBW)`** → `Promise<THREE.CanvasTexture>`
  Draws a 300×110 canvas with rounded rectangle background, icon, and IATA code text. Used for departure/arrival labels.
- **`createTransitionLabelTexture(timeText, transitionType, isBW)`** → `Promise<THREE.CanvasTexture>`
  Draws a 280×100 canvas with time text and sunrise/sunset icon. Used for day/night transition markers along the flight path.

### `animationUtils.js`
- **`animateValue(from, to, onUpdate, onComplete)`** → `{ cancel() }`
  Generic eased animation using `requestAnimationFrame`. 300ms duration, ease-out curve `t * (2 - t)`. Returns a controller with `cancel()` method. Used for all layer fade-in/fade-out transitions.

---

## App.jsx Structure

App.jsx is a single large React component. Here's how it's organized from top to bottom:

### 1. State Variables (lines 22–71)

| Group | Variables | Purpose |
|---|---|---|
| Loading | `isLoading`, `departureTime` | Initial load state, selected departure time |
| Airport Search | `departureCode/Search/Results/Airport`, `arrivalCode/Search/Results/Airport`, `selectedIndex`, `showSuggestions` | Two mirrored search input states |
| Flight | `flightPath`, `flightResults`, `isPlaying`, `animationProgress`, `showFlightStats` | Calculated flight data, animation state |
| UI Toggles | `showAirports`, `showGraticule`, `showPlaneIcon`, `showTimezones`, `showTwilightLines`, `isBWMode`, `autoRotate`, `followPlaneMode` | Feature toggles |
| Panel | `isPanelCollapsed`, `isPanelFading`, `expandedSection`, `aboutContent`, `dataContent`, `isClosing` | Control panel and accordion state |
| Mobile | `isMobile`, `showMobileMenu`, `isMobileMenuClosing`, `isMobileMenuAnimating` | Mobile UI state |

### 2. Refs (lines 73–121)

| Group | Refs | Purpose |
|---|---|---|
| Three.js Core | `canvasRef`, `sceneRef`, `cameraRef`, `controlsRef` | Scene infrastructure |
| Scene Objects | `flightLineRef`, `progressTubeRef`, `transitionLabelsRef`, `departureLabelRef`, `arrivalLabelRef`, `planeIconRef`, `twilightSphereRef`, `glowRef`, `twilightLinesRef` | Visual elements in the scene |
| Materials | `earthMaterialRef`, `ambientLightRef`, `planeTextureRef`, `planeBWTextureRef`, `bwColorsRef` | Materials and textures |
| Animation | `flightDataRef`, `animationProgressRef`, `hasFlightPathRef` | Flight animation state (non-rendering) |
| Feature Toggles | `autoRotateRef`, `showPlaneIconRef`, `isBWModeRef`, `followPlaneModeRef`, `isPlayingRef` | Mirror state for use in animation loop |

**Why both state and refs for toggles?** State drives React re-renders (UI updates). Refs are readable inside the Three.js animation loop without triggering re-renders. They're kept in sync via `useEffect` hooks.

### 3. Standalone Functions (lines 122–260)

- **`getCSSColor(varName)`** — Reads CSS custom property RGB values
- **`calculateTwilightBoundary(sunDirection, baseElevationAngle, currentTime)`** — Computes twilight boundary line positions with latitude-dependent width and solar declination effects. Contains the artistic tuning for twilight visualization.
- **`updateTwilightLines(sunDirection, currentTime)`** — Updates all 8 twilight boundary line geometries

### 4. useEffects — Initialization & Sync (lines 269–336)

- **Airport data loading** — Fetches from URL params, sets state
- **Ref sync effects** — `followPlaneMode`, `isPlaying`, `autoRotate` → refs
- **Mobile detection** — User agent + touch + screen width, runs on resize

### 5. Main Scene Setup useEffect (lines 338–1113)

This is the largest block (~775 lines). Runs once on mount (`[]` dependency). Contains:

1. **Airport data fetch** from OpenFlights CSV
2. **Scene creation** — Scene, camera (75° FOV, z=3.5), renderer (capped 2× pixel ratio)
3. **OrbitControls** — Damping, rotation speed, zoom disabled, min/max distance 3–3.5
4. **Globe** — SphereGeometry radius 2, 96 segments, custom Earth texture
5. **Plane icon** — PlaneGeometry mesh (not sprite), mobile-responsive size
6. **Atmospheric glow** — Custom vertex/fragment shader, BackSide rendering
7. **User location dot** — Geolocation API with Milan fallback
8. **Sun position calculation** — Initial subsolar point via `getSubsolarPoint()`
9. **Twilight shader sphere** — Custom GLSL fragment shader with:
   - Latitude-dependent twilight width
   - Solar declination effect on obliquity
   - `pow(darkness, 1.5)` gamma curve
   - Dithering to prevent banding
10. **Twilight boundary lines** — 8 Line2 objects (terminator/civil/nautical/astronomical × day/night)
11. **`updateSunPosition()`** — Real-time sun update (called when no flight animation)
12. **`updateSunPositionForTime(time)`** — Sun update for animation playback time
13. **Animation loop** — `requestAnimationFrame` with:
    - Mobile frame throttling (30fps cap)
    - Real-time sun position updates
    - Flight animation progress tube rendering
    - Transition label fade-in/fade-out at correct progress points
    - Plane icon positioning and orientation along path
    - Follow-plane camera mode
    - Location dot scale compensation
14. **Resize handler** — Camera, renderer, Line2 material resolution
15. **Cleanup** — Renderer dispose, event listener removal

### 6. Flight Path Cleanup useEffect (lines 1120–1148)

Triggers on `[departureSearch, arrivalSearch]`. When user edits search fields:
- Removes flight group from scene
- Disposes all geometries and materials
- Clears `transitionLabelsRef` array
- Resets animation state

### 7. Flight Path Drawing useEffect (lines 1150–1600)

Triggers on `[flightPath, flightResults, departureTime, departureCode, arrivalCode]`. The flight visualization pipeline:

1. **Great circle path** — Spherical interpolation (slerp) between departure and arrival, 100 points at radius 2.01
2. **Sun angle computation** — For each point along path, calculates sun angle at the corresponding time
3. **Color mapping** — Multi-threshold gradient system:
   - Differentiates sunset (warmer reds/oranges) vs sunrise (cooler purples/blues)
   - 8 angle bands: full daylight (<85°), approaching horizon (85–88°), near-horizon (88–91°), civil twilight (91–94°, 94–97°), nautical (97–100°), astronomical (100–108°), full darkness (>108°)
4. **Pre-calculated colors** — Both color and BW arrays computed once, stored in `userData`
5. **Transition detection** — Identifies day→night and night→day crossings along the path
6. **Thin base tube** — 0.002 radius, white, 30% opacity
7. **Transition labels and rings** — Pre-created at each transition point, initially hidden
8. **Airport dots** — Small spheres at departure/arrival
9. **Airport labels** — Sprites with offset positioning, created via `createAirportLabelTexture()`

### 8. Layer Toggle useEffects (lines 1633–2033)

Each layer follows the same pattern: fade-out existing → early return if toggled off → create new → fade-in.

- **Airport dots** (triggers: `showAirports`, `airports`, `isBWMode`) — Points geometry with circular canvas texture, resting opacity 0.8
- **Graticule** (triggers: `showGraticule`) — Loaded from GeoJSON, LineBasicMaterial, resting opacity 0.2
- **Timezone boundaries** (triggers: `showTimezones`) — Loaded from GeoJSON, includes International Date Line with curved label mesh, resting opacity 0.3
- **Twilight lines** (triggers: `showTwilightLines`) — requestAnimationFrame-based fade, individual target opacities per line type (terminator 0.8, civil 0.6, nautical 0.4, astronomical 0.2)

All layer fades use `animateValue()` from animationUtils (300ms ease-out), except twilight lines which have their own interpolation for per-line opacity targets.

### 9. BW Mode useEffects (lines 2118–2471)

- **Twilight line colors** — Switches between white/gray tones and dark gray
- **Scene transition** — 400ms animated transition handling:
  - Background color interpolation
  - Ambient light intensity
  - Twilight overlay intensity
  - Atmospheric glow color and blending mode
  - Graticule color
  - Flight path vertex colors (pre-calculated BW array swap)
  - Label texture swap at midpoint (fade out → swap → fade in)
  - Transition label texture swap
  - Ring, dot, and airport dot color updates

### 10. Animation & Playback (lines 2148–2176)

Flight animation using `setInterval` at 16ms. Speed based on distance (400 km/s visual speed). Clamps to 1.0, auto-stops, shows flight stats.

### 11. Keyboard Shortcuts (lines 2179–2119)

| Key | Action |
|---|---|
| Space | Play/pause animation |
| A | Toggle airports |
| P | Toggle plane icon |
| T | Toggle timezones (disables graticule) |
| G | Toggle graticule (disables timezones) |
| L | Toggle twilight lines |

### 12. Business Logic Functions (lines 2121–2470)

- **`centerCameraOnFlight(departure, arrival, flightDistance)`** — Smooth camera slerp to flight midpoint with 10° south tilt, 1500ms ease-in-out
- **`calculateFlight()`** — Main calculation: great circle distance (Haversine), duration estimate (750 km/h), daylight/darkness time sampling, state updates, URL update
- **`getAirportTimezone()`**, **`getLocalTimeAtAirport()`**, **`getTimezoneAbbreviation()`** — Timezone utilities using tz-lookup + Luxon
- **`searchAirports(query)`** — Priority-ordered search: exact IATA → prefix → city name, max 8 results

### 13. JSX Return (lines ~2470–3443)

UI structure:

```
<div className="app">
  Loading overlay (conditional)
  Version badge
  Mobile hamburger button + menu
  Desktop layer toggles (A, G, T, L, P, BW, Follow)
  Control panel:
    Departure search input + suggestions
    Arrival search input + suggestions  
    Date/time picker
    Calculate button
    Accordion sections (About, Data)
  <canvas> (Three.js render target)
  Animation controls (conditional, when flight exists):
    Flight stats (distance, duration, daylight, darkness)
    Departure/arrival time displays with timezone
    Curved SVG slider with progress thumb
    Play/pause button
</div>
```

---

## 3D Scene Object Hierarchy

```
Scene
├── Earth sphere (radius 2, 96 segments)
│   └── User location dot (radius 0.01)
├── Twilight shader sphere (radius 2.003, 128 segments)
├── Atmospheric glow sphere (radius 2.05, BackSide)
├── Sun directional light
├── Ambient light
├── Twilight boundary lines (8× Line2)
│   ├── terminatorDay / terminatorNight
│   ├── civilDay / civilNight
│   ├── nauticalDay / nauticalNight
│   └── astronomicalDay / astronomicalNight
├── Plane icon mesh (PlaneGeometry)
├── Flight group (when flight calculated)
│   ├── Thin base tube (radius 0.002)
│   ├── Progress tube (animated, radius 0.006)
│   ├── Departure dot + label sprite
│   ├── Arrival dot + label sprite
│   └── Transition labels + rings (per transition)
├── Airport dots (Points geometry, when toggled on)
├── Graticule group (LineBasicMaterial, when toggled on)
└── Timezone group (LineBasicMaterial + Date Line, when toggled on)
```

---

## Key Coordinate Conventions

- **Globe radius:** 2.0 (scene units)
- **Surface layers:** Twilight 2.003, graticule 2.004, timezones 2.005, airport dots 2.005, flight path 2.01
- **Coordinate system:** Y-up, with `latLonToVector3` converting geographic to 3D
- **Camera distance:** Default 3.5, range 3.0–3.5 (OrbitControls clamped)

---

## Data Flow

```
User selects airports → calculateFlight() → 
  ├── Haversine distance
  ├── Duration estimate (750 km/h)  
  ├── Great circle path (100 slerp points)
  ├── Sun angle at each point + time
  ├── Color gradient mapping (color + BW pre-calculated)
  ├── Transition detection (day↔night crossings)
  ├── Daylight/darkness time sampling
  └── setFlightPath() + setFlightResults()
        ↓
Flight path useEffect draws everything to scene
        ↓
Play button → setInterval updates animationProgress
        ↓  
Animation loop reads animationProgressRef:
  ├── Builds progress tube up to current point
  ├── Updates plane position + orientation
  ├── Fades transition labels at crossing points
  ├── Updates sun position for current flight time
  └── Follow-plane camera (if enabled)
```

---

## CSS Architecture

All styles in `App.css` (2,352 lines). Key patterns:

- CSS custom properties for theme colors (BW mode toggles `.bw-mode` class)
- Mobile responsive: `@media (max-width: 768px)` breakpoints
- Hamburger menu for mobile with slide-in animation
- Accordion sections with expand/collapse transitions
- Curved SVG slider for flight progress
- Glass-morphism panel with backdrop blur

---

## Version History Conventions

```bash
git add .
git commit -m "vX.X.XX: Description of changes"
git tag vX.X.XX
git push && git push --tags
```

- **Patch (0.x.N):** Bug fixes, cleanup, small tweaks
- **Minor (0.N.0):** New features, significant structural changes
- **Major (1.0.0):** Public release-ready

---

## Known Architectural Notes

- **Single component:** App.jsx contains all logic. Phase 3 (planned) will extract UI components.
- **State/ref duality:** Feature toggles exist as both `useState` (for React UI) and `useRef` (for animation loop access). Synced via `useEffect`.
- **No state management library:** All state is local `useState`. Works because there's only one component.
- **GeoJSON loaded at runtime:** Graticule and timezone boundaries fetched on toggle, not bundled.
- **Airport data from OpenFlights:** Fetched from GitHub raw URL on mount.
- **Custom Earth texture:** Created in QGIS, stored in `/public`.
- **Two color modes:** Every visual element has both color and BW variants. BW transition is animated over 400ms.
- **Zoom disabled:** OrbitControls zoom is off. Camera distance is controlled programmatically per-flight.
