# Lightpath — Application Architecture

**Version:** 0.8.0  
**Last updated:** March 2026  
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
| Build | Vite 7.3 | Dev server, production builds |
| Routing | react-router-dom 7.13 | Shareable flight URLs |
| Astronomy | solar-calculator 0.3 (NOAA) | Solar declination (full Julian century) |
| Astronomy | suncalc 1.9 (Jean Meeus) | Solar noon, sunrise/sunset events |
| Timezones | tz-lookup 6.1, Luxon 3.7 | Coordinate-to-timezone, formatting |
| Content | react-markdown 10.1 | About/Data panel markdown rendering |

---

## File Structure

```
src/
├── App.jsx                    (main component, ~3,500 lines)
├── App.css                    (all styles, ~2,700 lines)
├── components/
│   └── AirportSearchInput.jsx (reusable airport autocomplete input)
├── utils/
│   ├── geoUtils.js            (coordinate conversion + flight scaling)
│   ├── solarUtils.js          (solar position calculations)
│   ├── sceneUtils.js          (label texture creation)
│   ├── animationUtils.js      (fade animations)
│   └── idleAnimation.js       (idle globe animation — fully self-contained)
├── data/
│   └── idleAirports.js        (curated ~80 global hub airports for idle animation)
public/
├── earth-texture.png          (custom Earth texture, created in QGIS)
├── graticule-10.geojson       (10° latitude/longitude grid)
├── timezones.geojson          (timezone boundaries)
├── plane-icon.svg / plane-icon-bw.svg
├── departure-icon.svg / departure-icon-bw.svg
├── arrival-icon.svg / arrival-icon-bw.svg
├── sunrise-icon.svg / sunrise-icon-bw.svg
├── sunset-icon.svg / sunset-icon-bw.svg
├── about.md / data.md         (info panel content)
```

---

## Components

### `AirportSearchInput.jsx`

A reusable airport search input with autocomplete dropdown. Manages its own search/suggestions state internally. Used twice in App.jsx (departure and arrival).

**Internal state:** `search`, `results`, `showSuggestions`, `selectedIndex`

**Props:**
| Prop | Type | Purpose |
|---|---|---|
| `label` | string | "Departure" or "Arrival" |
| `code` | string | Selected IATA code (controlled by parent) |
| `airport` | object | Selected airport `{ city, country, ... }` (controlled by parent) |
| `searchAirports` | function | Search function: `(query) => results[]` |
| `onSelect` | function | Called when user picks an airport |
| `onSearchChange` | function | Called when user starts typing (signals parent to clear flight) |
| `onClear` | function | Called when clear button is clicked |

**Handles internally:** Text input, keyboard navigation (arrow keys, Enter), dropdown visibility, focus/blur, suggestion rendering, clear button.

**Label visibility:** The field label (`"Departure"` / `"Arrival"`) is hidden until an airport is confirmed (`showLabel = !!airport`). It uses inline `opacity` + `maxHeight` + `marginBottom` transitions (0.15s ease). While hidden, a placeholder `"${label} city or airport"` is shown instead, styled via `::placeholder` to be lowercase, lighter weight, and lower opacity.

**Autocomplete dropdown:** Has `z-index: 1000`. The parent `.panel-content` and `.flight-input` both use `overflow: visible` to prevent the dropdown from being clipped by the panel bounds.

**Future:** When alternative search modes are added (e.g., flight number lookup), this component stays as-is within the airport search mode.

---

## Utility Modules

### `geoUtils.js`
- **`latLonToVector3(lat, lon, radius)`** → `THREE.Vector3`
  Converts geographic coordinates to 3D position on the globe. Single source of truth for the app's coordinate convention (Y-up, negative X at 0° longitude, +180° theta offset).
- **`getFlightScale(distanceKm)`** → `{ cameraRadius, scaleFactor }`
  Distance-based scaling for short flights. Flights >2,000 km use default scale (1.0). Below that, camera zooms closer and visual elements shrink proportionally. Three tiers: 1,000–2,000 km, 500–1,000 km, <500 km.
- **`getViewportScale(windowWidth, referenceWidth?)`** → number
  Viewport-based scale factor to prevent 3D elements from growing too large on wide screens. Returns 1.0 at or below 1440px, progressively smaller above.

### `solarUtils.js`
- **`calculateSolarDeclination(date)`** → degrees
  Full NOAA equations via solar-calculator. Returns latitude where sun is directly overhead (-23.44° to +23.44°).
- **`getSubsolarPoint(time)`** → `{ latitude, longitude }`
  Combines SunCalc (Equation of Time for longitude) with declination (for latitude).
- **`getSunAngle(lat, lon, time)`** → degrees
  Spherical law of cosines: angular distance between a surface point and the subsolar point. <90° = daylight, 90° = horizon, >90° = night.
- **`isPointInDaylight(lat, lon, time)`** → boolean
  Returns true if sun angle < 95° (between geometric sunset at 90° and civil twilight at 96°).

### `sceneUtils.js`
- **`createAirportLabelTexture(code, iconSrc, isBW)`** → `Promise<THREE.CanvasTexture>`
  Draws a 300×110 canvas with rounded rectangle background, icon, and IATA code text.
- **`createTransitionLabelTexture(timeText, transitionType, isBW)`** → `Promise<THREE.CanvasTexture>`
  Draws a 280×100 canvas with time text and sunrise/sunset icon.

### `animationUtils.js`
- **`animateValue(from, to, onUpdate, onComplete)`** → `{ cancel() }`
  Generic eased animation using `requestAnimationFrame`. 300ms duration, ease-out curve `t * (2 - t)`. Used for all layer fade-in/fade-out transitions.

---

## App.jsx Structure

App.jsx is the main React component containing all 3D scene logic, state management, and UI rendering.

### 1. State Variables

| Group | Variables | Purpose |
|---|---|---|
| Loading | `isLoading`, `departureTime` | Initial load state, selected departure time |
| Airport Selection | `departureCode`, `arrivalCode`, `airports`, `departureAirport`, `arrivalAirport`, `searchEditing` | Selected airports and search edit counter (triggers flight cleanup) |
| Flight | `flightPath`, `flightResults`, `isPlaying`, `animationProgress`, `showFlightStats` | Calculated flight data, animation state |
| UI Toggles | `showAirports`, `showGraticule`, `showPlaneIcon`, `showTimezones`, `showTwilightLines`, `isBWMode`, `autoRotate`, `followPlaneMode` | Feature toggles |
| Panel | `isPanelCollapsed`, `isPanelFading`, `expandedSection`, `aboutContent`, `dataContent`, `isClosing` | Control panel and accordion state |
| Mobile | `isMobile`, `isHamburgerOpen`, `showMobileMenu`, `isMobileMenuClosing`, `isMobileMenuAnimating` | Mobile UI state |

**Important:** `departureTime` is initialized to `new Date()` and is always truthy. Always use `departureAirport` (not `departureTime`) as the condition for showing datetime-related UI.

### 2. Refs

| Group | Refs | Purpose |
|---|---|---|
| Three.js Core | `canvasRef`, `sceneRef`, `cameraRef`, `controlsRef` | Scene infrastructure |
| Scene Objects | `flightLineRef`, `progressTubeRef`, `transitionLabelsRef`, `departureLabelRef`, `arrivalLabelRef`, `planeIconRef`, `twilightSphereRef`, `glowRef`, `twilightLinesRef` | Visual elements in the scene |
| Materials | `earthMaterialRef`, `ambientLightRef`, `planeTextureRef`, `planeBWTextureRef`, `bwColorsRef` | Materials and textures |
| Animation | `flightDataRef`, `animationProgressRef`, `hasFlightPathRef` | Flight animation state (non-rendering) |
| Feature Toggles | `autoRotateRef`, `showPlaneIconRef`, `isBWModeRef`, `followPlaneModeRef`, `isPlayingRef` | Mirror state for use in animation loop |

**Why both state and refs for toggles?** State drives React re-renders (UI updates). Refs are readable inside the Three.js animation loop without triggering re-renders. Kept in sync via `useEffect` hooks.

### 3. Standalone Functions

- **`getCSSColor(varName)`** — Reads CSS custom property RGB values
- **`calculateTwilightBoundary(sunDirection, baseElevationAngle, currentTime)`** — Computes twilight boundary line positions with latitude-dependent width and solar declination effects.
- **`updateTwilightLines(sunDirection, currentTime)`** — Updates all 8 twilight boundary line geometries

### 4. useEffects — Initialization & Sync

- **URL parameter loading** — Reads flight route from URL params, auto-calculates flight
- **Ref sync effects** — `followPlaneMode`, `isPlaying`, `autoRotate` → refs
- **Mobile detection** — User agent + touch + screen width, runs on resize

### 5. Main Scene Setup useEffect

Runs once on mount (`[]` dependency). Contains airport data fetch, scene/camera/renderer creation, OrbitControls, globe, plane icon, atmospheric glow, user location dot, sun position, twilight shader sphere (custom GLSL), twilight boundary lines (8× Line2), animation loop, and resize handler.

### 6. Flight Cleanup useEffect

Triggers on `searchEditing` change. Removes flight path from scene, resets animation state, reopens panel.

### 7. Flight Path Drawing useEffect

Triggers on `flightPath` change. Builds the full 3D flight visualization with distance-based and viewport-based scaling applied to all elements.

### 8. Layer Toggle useEffects

Airport dots, graticule, timezone boundaries, twilight lines. Pattern: fade-out existing → early return if off → create new → fade-in.

### 9. BW Mode useEffects

400ms animated scene transition: background, ambient light, twilight overlay, glow, graticule/timezone color, flight path vertex colors (pre-calculated BW swap), label texture swap at midpoint, ring/dot colors.

### 10. Animation & Playback

Flight animation using `setInterval` at 16ms. Speed based on distance. Clamps to 1.0, auto-stops, shows flight stats.

### 11. Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play/pause animation |
| A | Toggle airports |
| P | Toggle plane icon |
| T | Toggle timezones (disables graticule) |
| G | Toggle graticule (disables timezones) |
| L | Toggle twilight lines |

### 12. Business Logic Functions

- **`centerCameraOnFlight(departure, arrival, flightDistance)`** — Smooth camera slerp to flight midpoint with 10° south tilt, 1500ms ease-in-out. Distance from `getFlightScale().cameraRadius`.
- **`calculateFlight()`** — Haversine distance, duration estimate (750 km/h), daylight/darkness sampling, state updates, URL update
- **`getAirportTimezone()`**, **`getLocalTimeAtAirport()`**, **`getTimezoneAbbreviation()`** — Timezone utilities using tz-lookup + Luxon
- **`searchAirports(query)`** — Priority: exact IATA → prefix → city name, max 8 results

### 13. JSX Return

```
<div className="app">
  Loading overlay (conditional)
  Mobile hamburger button
  Mobile off-canvas menu + background overlay
  Info overlay (logo + desktop nav accordion + footer)
  Desktop layer toggles (A, G, T, L, P, BW, Follow)
  Control panel (.flight-input):
    Panel header (title + collapse button)
    Panel subtitle (see Panel Subtitle section)
    Panel content (.panel-content):
      <AirportSearchInput> departure
      Swap airports button (only when both airports selected)
      <AirportSearchInput> arrival
      Datetime group (visible only after departure airport selected)
      Calculate Flight button (visible only after departure airport selected)
  <canvas> (Three.js render target)
  Animation controls (when flight exists):
    Flight stats (distance, duration, daylight, darkness)
    Departure/arrival time displays with timezone
    Curved SVG slider with progress thumb
    Play/pause button
</div>
```

---

## Panel Progressive Reveal

The search panel uses progressive disclosure to reduce visual noise at the start:

| State | Visible elements |
|---|---|
| Empty | Two airport inputs + subtitle only |
| Departure airport typed | Airport label fades in above input |
| Departure airport selected | Datetime group + Calculate button fade in |
| Both airports selected | Swap airports button appears |
| Flight calculated | Panel collapses, animation controls appear |

Hidden elements use inline styles with `opacity`, `maxHeight`, `marginBottom`, and `padding` transitions (0.15s ease). On mobile, `transition: none !important` is applied to `.datetime-group` and `.panel-subtitle` to prevent conflicts with the panel collapse animation.

**Mobile touch target fix:** The Calculate Flight button has `min-height: 44px` on touch devices via `@media (hover: none) and (pointer: coarse)`. The selector uses `:not(:disabled)` so the min-height only applies when the button is active, preventing phantom height when the button is hidden.

---

## Panel Subtitle & Color Styling

The subtitle below the panel header reads:
- **Desktop:** `"Find a route between any airport."`
- **Mobile:** `"Find a route between any airport and explore how your flight moves through daylight, twilight, and darkness."`

On mobile, the three words are wrapped in `<span>` elements styled with CSS classes that reference the same CSS variables as the 3D flight path:

| Class | Color source | Effect |
|---|---|---|
| `.subtitle-daylight` | `--path-day-color` | Solid color, opacity 0.8 |
| `.subtitle-twilight` | `--path-twilight-warm` → `--path-twilight-cool` | CSS gradient via `-webkit-background-clip: text` |
| `.subtitle-darkness` | `--path-night-color` | Solid color, `filter: brightness(1.4)`, opacity 0.9 |

Because these reference CSS variables, they automatically update if path color variables change. In BW mode the variables shift to grayscale, so the subtitle spans follow automatically.

The subtitle collapses smoothly when the panel collapses via `max-height: 80px` in expanded state and `max-height: 0` + `opacity: 0` + `margin: 0` in `.flight-input.collapsed .panel-subtitle`.

---

## CSS Architecture

All styles in `App.css`. Key patterns:

- CSS custom properties for theme colors (BW mode toggles `.bw-mode` class on root)
- Mobile responsive: `@media (max-width: 600px)` and `@media (max-width: 768px)` breakpoints
- Touch device overrides: `@media (hover: none) and (pointer: coarse)` for tap targets
- Mobile panel transitions disabled with `transition: none !important` on key elements to prevent conflicts with collapse animation
- Hamburger menu for mobile with fade + slide animations
- Accordion sections with expand/collapse transitions
- Curved SVG slider for flight progress
- Glass-morphism panel with backdrop blur
- `.panel-content` and `.flight-input` use `overflow: visible` to allow autocomplete dropdown to escape panel bounds
- Toggle overlays: three opacity states — dim (default) → medium (hover) → full (checked)

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
│   ├── Thin base tube (radius 0.002 × elementScale)
│   ├── Progress tube (animated, radius 0.006 × elementScale)
│   ├── Departure dot + label sprite (scaled)
│   ├── Arrival dot + label sprite (scaled)
│   └── Transition labels + rings (per transition, scaled)
├── Airport dots (Points geometry, when toggled on)
├── Graticule group (LineBasicMaterial, when toggled on)
└── Timezone group (LineBasicMaterial + Date Line, when toggled on)
```

---

## Key Coordinate Conventions

- **Globe radius:** 2.0 (scene units)
- **Surface layers:** Twilight 2.003, graticule 2.004, timezones 2.005, airport dots 2.005, flight path 2.01
- **Coordinate system:** Y-up, with `latLonToVector3` converting geographic to 3D
- **Camera distance:** Default 3.5, dynamically adjusted per flight via `getFlightScale()` (range 2.3–3.5)

---

## Data Flow

```
User selects airports (via AirportSearchInput) →
  onSelect → sets departureCode/Airport, arrivalCode/Airport in App.jsx
  onSearchChange → increments searchEditing → clears any existing flight

User clicks Calculate → calculateFlight() →
  ├── Haversine distance
  ├── Duration estimate (750 km/h)
  ├── getFlightScale(distance) → cameraRadius + scaleFactor
  ├── Great circle path (100 slerp points)
  ├── Sun angle at each point + time
  ├── Color gradient mapping (color + BW pre-calculated)
  ├── Transition detection (day↔night crossings)
  ├── Daylight/darkness time sampling
  └── setFlightPath() + setFlightResults()
        ↓
Flight path useEffect draws everything to scene (scaled)
        ↓
Play button → setInterval updates animationProgress
        ↓
Animation loop reads animationProgressRef:
  ├── Builds progress tube up to current point (scaled)
  ├── Updates plane position + orientation
  ├── Fades transition labels at crossing points
  ├── Updates sun position for current flight time
  └── Follow-plane camera (if enabled)
```

---

## Version History Conventions

```bash
git add .
git commit -m "vX.X.X: Description of changes"
git tag vX.X.X
git push && git push --tags
```

- **Patch (0.x.N):** Bug fixes, cleanup, small tweaks
- **Minor (0.N.0):** New features, significant structural changes
- **Major (1.0.0):** Public release-ready

---

## Known Architectural Notes

- **Single main component with extracted utilities:** App.jsx contains all 3D scene logic and state. UI components are being progressively extracted (`AirportSearchInput` is the first).
- **State/ref duality:** Feature toggles exist as both `useState` (for React UI) and `useRef` (for animation loop access). Synced via `useEffect`.
- **No state management library:** All state is local `useState`. Works because there's effectively one main component.
- **GeoJSON loaded at runtime:** Graticule and timezone boundaries fetched on toggle, not bundled.
- **Airport data from OpenFlights:** Fetched from GitHub raw URL on mount.
- **Custom Earth texture:** Created in QGIS, stored in `/public`.
- **Two color modes:** Every visual element has both color and BW variants. BW transition is animated over 400ms.
- **Dual pre-calculation:** Color and BW gradient arrays are pre-calculated at flight creation time to avoid terminator flash when toggling modes during animation.
- **Distance-based + viewport-based scaling:** Camera distance and all flight path element sizes scale via `getFlightScale()` (distance) combined with `getViewportScale()` (window width) into a single `elementScale` multiplier.
- **CSS specificity discipline:** Conflicts with large grouped selectors are a recurring source of bugs. Fixes often require removing old rule blocks entirely rather than adding overrides.
- **Progressive panel reveal:** Datetime group and Calculate button hidden until departure airport is selected, using inline style transitions. Mobile disables transitions on these elements to prevent conflicts with panel collapse animation.
- **`departureTime` is always truthy:** Initialized to `new Date()`. Always use `departureAirport` as the condition for showing datetime-related UI, never `departureTime`.
- **State/animation decoupling on mobile menu:** `isHamburgerOpen` drives the button visual state; `showMobileMenu` drives the menu render/animation. Keeping these separate prevents transition bugs.

---

## Roadmap

### Pre-launch (before v1.0.0)

- **Shareable flight URLs — auto-load on visit:** Infrastructure already in place (react-router-dom, URL params). Each flight generates its own URL. Remaining work: auto-load the flight when visiting a URL directly. Also requires `vercel.json` with a rewrite rule (`source: "/(.*)"` → `destination: "/index.html"`) to prevent 404s when navigating directly to a flight URL.
- **More precise terminator visualization:** Anchor visual gradients more tightly to actual astronomical boundaries (terminator at 90°, civil at 96°, nautical at 102°, astronomical at 108°). Key for credibility with scientifically-minded users.
- **Phase 3 UI component extraction:** Remaining work from the ongoing refactoring plan. Extract additional UI components from App.jsx following the pattern established by `AirportSearchInput`.
- **Final mobile polish pass:** Real-device testing on iPhone for any remaining edge cases.
- **Idle globe animation:** Animate random flight arcs on the globe when the app is in its initial state (no flight calculated). Disappears when the user clicks Calculate. See implementation plan below.

---

### Idle Animation — Implementation Plan

**Concept:** While the app is idle (no flight calculated), random great circle arcs draw themselves progressively across the globe as thin white lines, hold briefly, then fade out. Multiple routes overlap at different phases creating a live radar aesthetic. Triggered on mount, stopped and cleaned up when the user clicks Calculate.

**Data source:** Curated hardcoded list of ~80 major global airport hubs with lat/lon. Routes are randomly paired at runtime. No extra fetch, no external file — airports are already in memory and the great circle math is already implemented in `geoUtils.js`.

**Key design decisions (validated via preview):**
- Line style: thin white, additive blending, opacity ~0.18–0.25
- Route lifecycle: draw → hold 1.5s → fade out → remove from scene
- Default density: 8 routes simultaneously on desktop, 4 on mobile
- Draw speed: ~0.002 progress/frame (~8–10s per long-haul route)
- Airport dots: same curated hub list rendered as a `Points` layer (opacity ~0.4), visible during idle only

**Architecture — critical notes:**
- **Completely self-contained** — no shared state, refs, or logic with the main flight system
- `idleAnimation.js` manages all its own internal state (active flag, routes array, spawn timing, dots mesh)
- Only receives `scene` (Three.js Scene) and `isMobile` (boolean) as inputs
- Exposes two functions only: `startIdleAnimation(scene, isMobile)` and `stopIdleAnimation()`
- `idleAirports.js` exports a single constant `IDLE_AIRPORTS` — a plain array of `{ code, lat, lon }` objects
- Idle update is called once per frame from inside the existing App.jsx animation loop — a single function call, no other coupling
- **Do not restart** after a flight is cleared — idle is only for the first landing experience

**Files:**

`src/data/idleAirports.js`
- Exports `IDLE_AIRPORTS`: ~80 curated major global hubs with IATA code, lat, lon
- Plain data, no logic, no imports

`src/utils/idleAnimation.js`
- Imports `IDLE_AIRPORTS` from `../data/idleAirports`
- Imports `THREE` for geometry/material creation
- Internal state: `active` (bool), `routes` (array), `lastSpawnTime` (number), `dotsMesh` (Points)
- Each route object: `{ line, geo, pts, progress, opacity, state: 'drawing'|'holding'|'fading', holdFrames }`
- `startIdleAnimation(scene, isMobile)` — sets active, builds airport dots Points, begins spawning
- `stopIdleAnimation()` — sets active false, removes and disposes all routes and dots from scene
- `tickIdleAnimation(time)` — called each frame from App.jsx animation loop; handles spawning + per-route lifecycle updates
- Uses haversine distance filter: only pairs airports >3000km apart for dramatic arcs

**App.jsx — only 3 changes, nothing modified:**
1. Import: `import { startIdleAnimation, stopIdleAnimation, tickIdleAnimation } from './utils/idleAnimation'`
2. After scene setup: `startIdleAnimation(scene, isMobile)`
3. Inside animation loop: `tickIdleAnimation(time)` (one line, gated internally by active flag)
4. At top of `calculateFlight()`: `stopIdleAnimation()`

**Implementation steps:**
1. Create `src/data/idleAirports.js` with the ~80 hub airport list
2. Create `src/utils/idleAnimation.js` with `startIdleAnimation`, `stopIdleAnimation`, `tickIdleAnimation`
3. Add the 3 import + call lines to App.jsx
4. Test idle animation in isolation (before wiring Calculate cleanup)
5. Test cleanup: confirm all geometry disposed, no memory leaks, scene clean after Calculate
6. Mobile: verify 4-route cap, check frame rate alongside twilight shader on real device

### Post-launch (after v1.0.0)

- **Flight video export:** Record the Three.js canvas during animation playback and export as MP4/WebM for social sharing. Approach: `MediaRecorder` API + `canvas.captureStream()` (no extra libraries needed). Key challenges: controlling animation framerate during recording (must decouple from screen refresh rate), UI visibility decisions, and file size management. CCapture.js is an alternative if frame-by-frame control is needed.
- **Flight number search / historical flight paths:** Look up a real flight by number and visualize its actual route and schedule. API approach undecided — OpenSky has CORS issues; options include a backend proxy, AviationStack API, or a pre-downloaded dataset.
- **Flight-path solar profile spiral visualization:** A secondary view showing sun angle over the duration of the flight as a spiral or timeline chart.
- **Flight query analytics / heatmaps:** Aggregate visualization of popular routes or most-searched airports.
- **Three.js upgrade:** Currently on 0.182, intentionally deferred. Upgrade to latest when time allows; check migration guide for Line2/LineMaterial and shader changes.
