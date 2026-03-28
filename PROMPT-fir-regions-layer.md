# Implement FIR Regions Layer (like Timezones)

## Context

The app is a React 19 + Three.js 3D globe visualization (`src/App.jsx` is the main monolithic component). There is already a **timezones layer** that loads `/public/timezones.geojson`, renders GeoJSON polygon boundaries as `THREE.Line` objects on the globe, and supports interactive hover highlighting + tooltip. A new file `/public/fir-regions.geojson` has been added and needs to appear as an identical layer.

## Requirements

- Render `fir-regions.geojson` as a layer exactly like the timezones one (boundary lines on the globe).
- **No UI toggle** (no checkbox in desktop overlay or mobile menu).
- Visibility is controlled **only** by the `F` keystroke (press to show, press again to hide).
- The layer should follow all existing patterns: fade-in/out animation, proper Three.js disposal on hide, support for BW mode colors, correct radius placement above the Earth sphere.
- On hover, show a **tooltip with the FIR name** (and ICAO code), plus **highlight the hovered region** — exactly like the timezone layer does.

## GeoJSON properties reference

Each feature in `fir-regions.geojson` has these properties:

- `FIR_NAME` — the FIR name, e.g. `"WASHINGTON"`, `"ALGER"`, `"TRIPOLI"` (null for 35 out of 332 features)
- `ICAO_CODE` — the ICAO identifier, e.g. `"KZDC"`, `"DAAA"` (null when FIR_NAME is null)
- `TYPE` — always `"FIR"`
- `FID` — numeric feature ID

All geometries are `MultiPolygon`. Total: 332 features (297 named, 35 unnamed).

## Plan (step by step)

All changes are in **`src/App.jsx`** only (no CSS changes needed since there's no UI toggle).

### Step 1 — Add state and ref

Around line 72, next to the existing `showTimezones` state, add:

```js
const [showFirRegions, setShowFirRegions] = useState(false)
```

Add a data ref to cache the parsed GeoJSON (same pattern as `timezoneDataRef`):

```js
const firDataRef = useRef(null)
```

Add a ref to track the currently highlighted FIR feature index (same pattern as `highlightedTimezoneRef`):

```js
const highlightedFirRef = useRef(null)
```

### Step 2 — Add the rendering `useEffect`

Model it exactly on the timezone rendering effect (lines ~2096–2279), but without the date line or date line label. Create a new `useEffect` with dependency `[showFirRegions]`:

1. **Cleanup:** Find the existing group by name `'fir-boundaries'`. If it exists, fade its opacity from 0.3 → 0 using `animateValue`, then remove from scene and dispose all geometries/materials.
2. **Early exit:** If `!showFirRegions`, return.
3. **Fetch & parse:** `fetch('/fir-regions.geojson')` → `.json()`. Store the result in `firDataRef.current`.
4. **Build Three.js lines:** For each GeoJSON feature:
   - Handle both `Polygon` and `MultiPolygon` geometry types (all features are MultiPolygon in practice).
   - For each ring, convert `[lon, lat]` coordinates to 3D vectors using `latLonToVector3(lat, lon, 2.005)` (same radius as timezones).
   - Create a `THREE.BufferGeometry` from the vectors.
   - Create a `THREE.Line` with a `THREE.LineBasicMaterial`:
     - `color`: `isBWMode ? 0x0f0f0f : 0xffffff`
     - `transparent: true`
     - `opacity: 0`
   - Store `line.userData.featureIndex = i` on each line.
   - Add line to a `THREE.Group`.
5. **Name the group** `'fir-boundaries'` and add it to `sceneRef.current`.
6. **Animate in:** Use `animateValue(0, 0.3, ...)` to fade all materials' opacity from 0 → 0.3.

Important: reference `isBWMode` via `isBWModeRef.current` (the ref, not the state directly) to avoid adding it as a dependency, consistent with how the timezone effect works.

### Step 3 — Add tooltip and hover highlighting `useEffect`

Model this exactly on the timezone tooltip/highlight effect (lines ~2281–2412). Create a new `useEffect` with dependencies `[showFirRegions, isMobile, isBWMode]`:

1. **Early exit** if `!showFirRegions` or `isMobile`.
2. **`handleMouseMove`:** On mouse move over the canvas:
   - Raycast against the Earth mesh to find the surface intersection point.
   - Convert the intersection point to `{ lat, lon }` using the existing `vector3ToLatLon` helper.
   - **Tooltip text:** Look up the FIR region using point-in-polygon (same `pointInPolygon` from `point-in-polygon-hao` already imported). Iterate through `firDataRef.current.features`, testing each polygon. When a match is found, display the tooltip using the existing `tooltipRef`:
     - If `FIR_NAME` is not null: show `"FIR_NAME · ICAO_CODE"` (e.g. `"WASHINGTON · KZDC"`)
     - If `FIR_NAME` is null: show `"Unknown FIR"` or hide tooltip
   - **Position tooltip** at `clientX + 16, clientY + 16` (same offset as timezone tooltip).
   - **Highlight:** Same throttling pattern (3px minimum movement). When the matched feature index changes:
     - Set matched feature lines to `opacity: 1.0`
     - Dim all other feature lines to `opacity: 0.1`
     - Track in `highlightedFirRef.current`
3. **`resetHighlight`:** Reset all lines in `'fir-boundaries'` group back to `opacity: 0.3` and default color. Clear `highlightedFirRef.current`.
4. **`handleMouseLeave`:** Hide tooltip, call `resetHighlight`.
5. **Cleanup:** Remove event listeners on effect cleanup.

Important: reuse the **same `tooltipRef`** element that the timezone layer uses — do not create a second tooltip div. The two layers won't be active simultaneously in practice, but even if they were, only one tooltip should show.

### Step 4 — Add keyboard shortcut

In the existing `keydown` event listener (around line 2550+), add a block for the `F` key:

```js
if (e.key === 'f' || e.key === 'F') {
  setShowFirRegions(prev => !prev)
}
```

Unlike timezones, there is **no mutual exclusivity** with graticule or any other layer — it's a simple toggle.

### Step 5 — Add `showFirRegions` to the cleanup on unmount

Make sure the FIR group is disposed if the component unmounts. In the main cleanup return function of the scene setup effect, add disposal logic for `'fir-boundaries'` (same pattern as `'timezone-boundaries'`).

## Handling date-line split FIRs

Some FIR regions (e.g. ANCHORAGE OCEANIC / PAZA) straddle the International Date Line and are stored as **separate features** in the GeoJSON — one with longitudes near +180°, the other near -180°. They share the same `FIR_NAME` + `ICAO_CODE`. These must **not** be merged in the GeoJSON (stitching coordinates across ±180° creates lines that wrap around the entire globe).

Instead, handle this **in code** at two levels:

### In the rendering effect (Step 2)

After parsing the GeoJSON, build a lookup map that groups feature indices by their `FIR_NAME + ICAO_CODE` key:

```js
const firGroupMap = {}  // key: "FIR_NAME|ICAO_CODE" → value: [featureIndex, featureIndex, ...]
data.features.forEach((f, i) => {
  const name = f.properties.FIR_NAME
  const icao = f.properties.ICAO_CODE
  if (name && icao) {
    const key = `${name}|${icao}`
    if (!firGroupMap[key]) firGroupMap[key] = []
    firGroupMap[key].push(i)
  }
})
```

Store this map in a ref (`firGroupMapRef`) so the hover effect can use it.

When creating Three.js lines, store **both** `line.userData.featureIndex = i` (for individual identification) and `line.userData.groupKey = key` (for group highlighting).

### In the hover/highlight effect (Step 3)

When a point-in-polygon match is found for feature index `i`:

1. Look up its `groupKey` from the matched feature's properties (`FIR_NAME|ICAO_CODE`).
2. Get all sibling indices from `firGroupMapRef.current[groupKey]`.
3. **Highlight all siblings together** — set opacity 1.0 on every line whose `userData.featureIndex` is in the sibling list, and dim all others to 0.1.
4. Track the `groupKey` (not just the feature index) in `highlightedFirRef.current` to avoid redundant updates when the mouse moves between sibling polygons.

This way, hovering over either half of a date-line-split FIR highlights the entire region as one.

## Important implementation notes

- **Do not add any UI checkbox** (no desktop overlay, no mobile menu item).
- **Do not create a separate component** — keep everything in `App.jsx`, following the existing pattern.
- The `latLonToVector3` helper already exists (around line 170) — reuse it.
- The `vector3ToLatLon` helper already exists — reuse it for converting raycast hit to lat/lon.
- The `animateValue` helper already exists — reuse it.
- `isBWModeRef` already exists — use it for color decisions inside the effect.
- `pointInPolygon` from `point-in-polygon-hao` is already imported — reuse it.
- Reuse the existing `tooltipRef` element — do not create a second tooltip DOM node.
- Use `THREE.Group` named `'fir-boundaries'` so it can be found/removed by name.
- The GeoJSON contains only `MultiPolygon` geometries, but handle `Polygon` as well for safety.
