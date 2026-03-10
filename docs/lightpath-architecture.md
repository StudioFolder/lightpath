# Lightpath — Application Architecture

**Version:** 0.7.7 (dev branch — UI redesign in progress)  
**Last updated:** March 2026  
**Repository:** StudioFolder/lightpath on GitHub  
**Deployment:** Vercel (automatic pipeline)  
**Active branch:** `dev` (will merge to `master` with version bump once UI redesign is complete)

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

## Fonts

| Font | File | Usage |
|---|---|---|
| ABC Repro | `ABCRepro-Screen.otf` | Primary UI font (replaces Inter) |
| ABC Repro Mono | `ABCReproMono-Thin.otf` | IATA codes in route mode, time displays (replaces MonoWeb) |

Both loaded via `@font-face` in App.css from `/fonts/`.

---

## File Structure

```
src/
├── App.jsx                    (main component — 3D scene, state, non-panel UI)
├── App.css                    (all styles — will be split per-component after redesign)
├── components/
│   ├── AirportSearchInput.jsx (reusable airport autocomplete input)
│   ├── FlightInputPanel.jsx   (flight search panel — two-column layout with route mode)
│   └── AnimationControls.jsx  (flight playback controls — slider, times, play/pause)
├── utils/
│   ├── geoUtils.js            (coordinate conversion + flight scaling)
│   ├── solarUtils.js          (solar position calculations)
│   ├── sceneUtils.js          (label texture creation)
│   └── animationUtils.js      (fade animations)
public/
├── fonts/
│   ├── ABCRepro-Screen.otf
│   └── ABCReproMono-Thin.otf
├── earth-texture.png          (custom Earth texture, created in QGIS)
├── graticule-10.geojson       (10° latitude/longitude grid)
├── timezones.geojson          (timezone boundaries)
├── plane-icon.svg / plane-icon-bw.svg
├── departure-icon.svg / departure-icon-bw.svg
├── arrival-icon.svg / arrival-icon-bw.svg
├── sunrise-icon.svg / sunrise-icon-bw.svg
├── sunset-icon.svg / sunset-icon-bw.svg
├── swap-icon.svg / swap-icon-bw.svg
├── date-icon.svg / date-icon-bw.svg
├── time-icon.svg / time-icon-bw.svg
├── about.md / data.md         (info panel content)
```

---

## Components

### `FlightInputPanel.jsx`

The main flight search panel. Extracted from App.jsx. Contains two layout states controlled by an internal `hasEnteredRouteMode` flag.

**Internal state:**
- `hasEnteredRouteMode` (boolean, via useState) — Set to `true` the first time both airports are selected. Irreversible within a session. Computed during render: `if (departureAirport && arrivalAirport && !hasEnteredRouteMode) setHasEnteredRouteMode(true)`.

**Props:**

| Group | Props |
|---|---|
| State | `departureCode`, `arrivalCode`, `departureAirport`, `arrivalAirport`, `departureTime`, `airports`, `isPanelCollapsed`, `isPanelFading`, `isBWMode`, `isMobile`, `isPlaying`, `showMobileMenu` |
| Callbacks | `setDepartureCode`, `setDepartureAirport`, `setArrivalCode`, `setArrivalAirport`, `setSearchEditing`, `setDepartureTime`, `setIsPanelCollapsed`, `setIsPanelFading`, `setShowFlightStats`, `setIsHamburgerOpen`, `setIsMobileMenuClosing`, `setExpandedSection`, `setShowMobileMenu`, `setIsMobileMenuAnimating` |
| Functions | `searchAirports`, `calculateFlight`, `getAirportTimezone` |

**Layout states:**

| State | Layout | Elements |
|---|---|---|
| Initial (pre-route mode) | Two-column with subtitle | Panel header, subtitle (all-caps with torch effect), FROM/TO column labels, pill-shaped input fields, swap button |
| Route mode (post both airports selected) | Two-column with large codes | Panel header, FROM/TO labels (repositioned to top), large IATA codes (ABCReproMono, 48px), city name, country, swap button between codes |

**Panel structure:**

```
<div className="flight-input-wrapper">      ← positioning container
  <div className="flight-input">             ← main panel (glass morphism)
    <div className="panel-header">           ← darker background strip
      <h3>Search Route</h3>
      <button className="collapse-button">   ← arrow / search lens icon
    </div>
    <p className="panel-subtitle">           ← hidden in route mode via .hidden class
    <div className="panel-content">
      {!hasEnteredRouteMode ? (
        <div className="airport-columns">    ← initial state
      ) : (
        <div className="airport-columns route-mode">  ← route mode
      )}
    </div>
  </div>

  {departureAirport && !isPanelCollapsed && (
    <div className="flight-action-row">      ← detached pills, 12px below main panel
      <div className="datetime-pill">        ← split date + time inputs with custom icons
      {arrivalAirport && (
        <button className="calculate-pill">  ← appears when both airports selected
      )}
    </div>
  )}
</div>
```

**Datetime pill:** Contains two separate native inputs (`type="date"` and `type="time"`) for independent date and time editing. The date input is hidden behind formatted display text ("March 10, 2026") that triggers the native picker on click. The time input is visible and styled directly. Custom SVG icons (`date-icon.svg`, `time-icon.svg`) replace browser defaults. The native time picker indicator is hidden via `::-webkit-calendar-picker-indicator`.

**Collapsed state:** When the panel collapses (after Calculate or via the collapse button), the `.flight-input-wrapper` approach means the collapsed panel centers itself via `margin: auto`. The collapsed panel design is unchanged from the pre-redesign version. The flight-action-row is hidden when `isPanelCollapsed` is true.

**Panel header:** Has its own darker background (`rgba(20, 20, 20, 0.5)`) using negative margins to stretch to panel edges. Background becomes transparent when collapsed. Height is 56px expanded, auto when collapsed. In BW mode, background changes to `rgba(240, 240, 240, 0.8)`.

**Design principles:**
- Panel overall dimensions don't change between initial and route mode — only content changes
- Color mode: no border, deep shadow (`0 12px 48px rgba(0, 0, 0, 0.3)`)
- BW mode: border (`1px solid var(--bw-border-light)`), shallow shadow (`0 4px 16px rgba(0, 0, 0, 0.08)`)
- All panel transitions between color/BW modes animate at 0.4s to match the Three.js scene transition
- The Calculate pill keeps a border stroke in both modes (it's a button, not a panel)

### `AnimationControls.jsx`

Flight playback controls panel. Extracted from App.jsx.

**Props:**

| Group | Props |
|---|---|
| State | `flightPath`, `flightResults`, `flightData`, `animationProgress`, `isPlaying`, `showFlightStats`, `departureCode`, `arrivalCode`, `isBWMode` |
| Callbacks | `onProgressChange`, `setIsPlaying`, `setIsPanelCollapsed`, `setShowFlightStats` |
| Functions | `getTimezoneAbbreviation`, `getLocalTimeAtAirport`, `getLocalDateAtAirport`, `formatFlightTime` |

**Key design decisions:**
- `flightData` is passed as a value (from `flightDataRef.current` in App.jsx), not as a ref — keeps the component pure
- `onProgressChange` is a single callback that updates both `setAnimationProgress` (React state) and `animationProgressRef.current` (for the Three.js animation loop). Defined in App.jsx as `handleProgressChange`.
- `currentTime` is computed once at the top of the component from `flightData.departureTime + animationProgress * flightDurationMs`, avoiding repeated inline calculations

**Structure:**
```
<div className="animation-controls">
  Flight stats (distance, duration, daylight, darkness)
  Animation header:
    Left: timezone abbreviation, local time (large), date
    Center: route (DEP ✈ ARR), distance counter, elapsed time
    Right: timezone abbreviation, local time (large), date
  Curved SVG slider with drag (mouse + touch)
  Play/Pause button
</div>
```

**Redesign status:** The AnimationControls panel will undergo a lighter visual redesign (typography, color, transparencies) compared to FlightInputPanel. It will adopt the same two-column layout language. See Figma reference screenshots for target design.

### `AirportSearchInput.jsx`

A reusable airport search input with autocomplete dropdown. Manages its own search/suggestions state internally. Used twice within `FlightInputPanel.jsx` (departure and arrival), rendered differently based on the panel's layout state (pill-shaped input in initial state, large code display in route mode) purely through CSS.

**Internal state:** `search`, `results`, `showSuggestions`, `selectedIndex`

**Props:**

| Prop | Type | Purpose |
|---|---|---|
| `label` | string | "From" or "To" |
| `code` | string | Selected IATA code (controlled by parent) |
| `airport` | object | Selected airport `{ city, country, ... }` (controlled by parent) |
| `searchAirports` | function | Search function: `(query) => results[]` |
| `onSelect` | function | Called when user picks an airport |
| `onSearchChange` | function | Called when user starts typing (signals parent to clear flight) |
| `onClear` | function | Called when clear button is clicked |
| `onFocusChange` | function | Optional. Called with `true`/`false` on input focus/blur |

**Route mode behavior:** In route mode, the same `AirportSearchInput` component renders but CSS transforms it: the input background becomes transparent, font size becomes 48px in ABCReproMono, placeholder is hidden, and the airport-name-inline is hidden (city/country displayed separately by FlightInputPanel). The clear button (×) appears on hover. Clicking the large code allows inline editing with autocomplete.

**Autocomplete dropdown:** Has `z-index: 1000`. The `.flight-input` has `position: relative; z-index: 2` and `.flight-action-row` has `z-index: 1` to ensure the dropdown renders above the detached pills. In the column layout, the dropdown is widened to 300px and centered via `transform: translateX(-50%)`.

---

## Utility Modules

### `geoUtils.js`
- **`latLonToVector3(lat, lon, radius)`** → `THREE.Vector3`
  Converts geographic coordinates to 3D position on the globe.
- **`getFlightScale(distanceKm)`** → `{ cameraRadius, scaleFactor }`
  Distance-based scaling for short flights.
- **`getViewportScale(windowWidth, referenceWidth?)`** → number
  Viewport-based scale factor.

### `solarUtils.js`
- **`calculateSolarDeclination(date)`** → degrees
- **`getSubsolarPoint(time)`** → `{ latitude, longitude }`
- **`getSunAngle(lat, lon, time)`** → degrees
- **`isPointInDaylight(lat, lon, time)`** → boolean

### `sceneUtils.js`
- **`createAirportLabelTexture(code, iconSrc, isBW)`** → `Promise<THREE.CanvasTexture>`
- **`createTransitionLabelTexture(timeText, transitionType, isBW)`** → `Promise<THREE.CanvasTexture>`

### `animationUtils.js`
- **`animateValue(from, to, onUpdate, onComplete)`** → `{ cancel() }`
  Generic eased animation. 300ms duration, ease-out curve.

---

## App.jsx Structure

App.jsx is the main React component containing all 3D scene logic, state management, and non-panel UI rendering. The two main UI panels (FlightInputPanel and AnimationControls) have been extracted as separate components.

### 1. State Variables

| Group | Variables | Purpose |
|---|---|---|
| Loading | `isLoading`, `departureTime` | Initial load state, selected departure time |
| Airport Selection | `departureCode`, `arrivalCode`, `airports`, `departureAirport`, `arrivalAirport`, `searchEditing`, `pendingUrlFlight` | Selected airports and search state |
| Flight | `flightPath`, `flightResults`, `isPlaying`, `animationProgress`, `showFlightStats` | Calculated flight data, animation state |
| UI Toggles | `showAirports`, `showGraticule`, `showPlaneIcon`, `showTimezones`, `showTwilightLines`, `isBWMode`, `autoRotate`, `followPlaneMode` | Feature toggles |
| Panel | `isPanelCollapsed`, `isPanelFading`, `expandedSection`, `aboutContent`, `dataContent`, `isClosing` | Control panel and accordion state |
| Mobile | `isMobile`, `isHamburgerOpen`, `showMobileMenu`, `isMobileMenuClosing`, `isMobileMenuAnimating` | Mobile UI state |

### 2. JSX Return (current)

```
<div className="app">
  Info overlay (logo)
  Mobile hamburger button
  Mobile off-canvas menu + background overlay
  Nav accordion (About, Data — desktop only)
  Desktop layer toggles (A, G, T, L, BW, Follow)
  Footer info
  <FlightInputPanel ...props />
  <canvas> (Three.js render target)
  {flightResults && <AnimationControls ...props />}
  <Analytics />
</div>
```

### 3. Key Functions Passed to Components

| Function | Defined in | Used by | Purpose |
|---|---|---|---|
| `searchAirports` | App.jsx | FlightInputPanel | Airport search: exact IATA → prefix → city name |
| `calculateFlight` | App.jsx | FlightInputPanel | Haversine distance, duration, path calculation |
| `getAirportTimezone` | App.jsx | FlightInputPanel | tz-lookup wrapper |
| `handleProgressChange` | App.jsx | AnimationControls | Updates both state and ref for animation progress |
| `getTimezoneAbbreviation` | App.jsx | AnimationControls | Luxon timezone formatting |
| `getLocalTimeAtAirport` | App.jsx | AnimationControls | Luxon time formatting |
| `getLocalDateAtAirport` | App.jsx | AnimationControls | Luxon date formatting |
| `formatFlightTime` | App.jsx | AnimationControls | Elapsed time formatting |

---

## Panel Progressive Reveal (Redesigned)

The search panel now uses a two-state system instead of the previous multi-step progressive reveal:

| State | Trigger | Visible elements |
|---|---|---|
| Initial | Page load | Panel header, subtitle, FROM/TO columns with pill-shaped inputs, swap button |
| + Departure selected | First airport picked | Datetime pill appears below panel (date + time with icons) |
| + Both selected | Second airport picked | Route mode activates (irreversible): subtitle fades out, large IATA codes appear, city/country details shown, Calculate pill appears |
| Flight calculated | Calculate clicked | Datetime + Calculate pills fade out, main panel collapses |

The transition from initial to route mode is one-way — the panel never returns to the initial layout within a session.

---

## CSS Architecture

All styles currently in `App.css` (~2,900 lines). **Planned:** Split into per-component CSS files after redesign is complete.

### Key CSS Patterns

- CSS custom properties for theme colors (BW mode toggles `.bw-mode` class on root)
- **Color mode:** No borders on panels, deep shadows (`0 12px 48px`)
- **BW mode:** Borders on panels (`var(--bw-border-light)`), shallow shadows (`0 4px 16px`)
- **Mode transition:** `background`, `border`, `box-shadow` all transition at 0.4s ease to match Three.js scene transition
- Glass-morphism panels with `backdrop-filter: blur(20px)`
- Panel header has its own darker background, stretched via negative margins
- `.flight-input-wrapper` provides positioning context; `.flight-input` centers within it via `margin: auto`
- `.flight-action-row` sits as a sibling below `.flight-input` inside the wrapper, with `z-index: 1` so autocomplete dropdowns render above
- Mobile responsive: `@media (max-width: 600px)` and `@media (max-width: 768px)` breakpoints
- Touch device overrides: `@media (hover: none) and (pointer: coarse)` for tap targets
- `overflow: visible` on `.panel-content` to allow autocomplete dropdown to escape panel bounds

### New CSS Classes (from redesign)

| Class | Purpose |
|---|---|
| `.flight-input-wrapper` | Absolute positioning container for panel + pills |
| `.airport-columns` | Flex row for two-column layout |
| `.airport-columns.route-mode` | Modifier for large-code display state |
| `.airport-column` | Flex column for each airport (FROM / TO) |
| `.column-label` | "FROM" / "TO" uppercase labels |
| `.swap-airports-column` | Center column holding swap button |
| `.airport-details` | City + country text below IATA code in route mode |
| `.flight-action-row` | Flex row for detached datetime + calculate pills |
| `.datetime-pill` | Rounded container for date/time inputs |
| `.datetime-display` | Flex row with `justify-content: space-between` for date (left) and time (right) |
| `.datetime-field` | Wrapper for icon + input pair (date or time) |
| `.datetime-native-input` | Styled native time input |
| `.datetime-hidden-input` | Invisible native date input (behind formatted text) |
| `.datetime-value` | Formatted date display text |
| `.calculate-pill` | Rounded Calculate button (keeps border in both modes) |
| `.panel-subtitle.hidden` | Fades out subtitle when entering route mode |

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
User selects airports (via AirportSearchInput inside FlightInputPanel) →
  onSelect → sets departureCode/Airport, arrivalCode/Airport in App.jsx
  onSearchChange → increments searchEditing → clears any existing flight
  hasEnteredRouteMode flag set when both airports first selected (irreversible)

Departure airport selected → datetime pill appears below panel
Both airports selected → route mode activates, Calculate pill appears

User clicks Calculate → calculateFlight() in App.jsx →
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
AnimationControls renders with flightResults
Play button → setInterval updates animationProgress
        ↓
Animation loop reads animationProgressRef (via handleProgressChange):
  ├── Reveals progress tube via drawRange
  ├── Updates plane position + orientation
  ├── Fades transition labels at crossing points
  ├── Updates sun position for current flight time
  └── Follow-plane camera (if enabled)
```

---

## Version History Conventions

Development work uses descriptive commit messages on `dev` branch without version bumps:
```bash
git add . && git commit -m "Description of changes" && git push
```

Version bumps and tags happen on merge to `master`:
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

- **Component extraction complete for panels:** `FlightInputPanel` and `AnimationControls` are extracted. `AirportSearchInput` was extracted previously. App.jsx retains all 3D scene logic, state management, and non-panel UI (info overlay, mobile menu, layer toggles, footer).
- **State/ref duality:** Feature toggles exist as both `useState` (for React UI) and `useRef` (for animation loop access). Synced via `useEffect`.
- **No state management library:** All state is local `useState` in App.jsx. Props are passed down to extracted components.
- **`hasEnteredRouteMode` pattern:** Computed during render via `useState` (not `useEffect`, to avoid cascading render warnings). Once true, never reverts. Controls the two-column layout switch in FlightInputPanel.
- **`departureTime` is always truthy:** Initialized to `new Date()`. Always use `departureAirport` as the condition for showing datetime-related UI.
- **Swap button opacity quirk:** The hover opacity must be set to 0.95 (not 1.0) to avoid a flicker caused by specificity conflicts with generic `.flight-input button:hover` rules. The `!important` on `transition: opacity 0.2s ease !important` is required to override inherited transitions.
- **CSS specificity debt:** Many `!important` declarations exist on swap button and clear button styles to override the generic `.flight-input button` rule. Planned cleanup: make `.flight-input button` more specific or split CSS per component.
- **CSS split planned:** After redesign is complete, App.css will be split into per-component files (FlightInputPanel.css, AnimationControls.css, AirportSearchInput.css) to eliminate specificity conflicts and improve maintainability.

---

## UI Redesign Status (dev branch)

### Completed
- FlightInputPanel extracted and restructured with two-column layout
- AnimationControls extracted with clean prop interface
- Two layout states (initial / route mode) implemented
- New fonts integrated (ABCRepro, ABCReproMono)
- Custom SVG icons for swap, date, time
- Split date/time inputs with native pickers
- BW mode styles for all new elements
- Panel shadow/border differentiation (color vs BW mode)
- Autocomplete dropdown z-index fixed above pills
- Collapsed panel centering and header styling

### Remaining (next chat session)
- **Mobile responsive styles** for the redesigned FlightInputPanel
- **Transition animations:** subtitle fade-out, FROM/TO label repositioning, IATA code fade-in on entering route mode
- **Rotating placeholder animation** (cycling "City", "Airport", "IATA code", "ICAO code") — parked
- **AnimationControls visual refinements** (typography, spacing, transparency adjustments to match new design language)
- **CSS cleanup pass:** Remove dead rules, split into per-component files
- **Native datetime input font:** `font-family: inherit` doesn't work on native date/time inputs — needs investigation
- **Final testing** across all states, both modes, desktop and mobile
- **Version bump and merge** to master
