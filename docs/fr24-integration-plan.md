# FlightRadar24 API Integration Plan

**Project**: Lightpath
**Feature**: Historical Flight Route Tracking
**Target**: v1.0.0 (currently v0.9.6)
**Date**: 2026-03-20
**Status**: Phase 4 complete (caching, deep links, date-independence implemented)
**Alternative approach**: `api-plan-adsbexchange.md` (ADSBexchange via RapidAPI, Feb 2026)

---

## 1. Overview

### Goal

Allow users to search for a specific flight by number (e.g., "KL1613") and visualize the **most probable route** based on the last flown instance of that flight, alongside the existing great circle route mode. The two modes coexist: users can either calculate a generic route between any two airports on the planet, or look up a specific flight and see its actual route.

### Why FR24 over ADSBexchange

The original `api-plan.md` was built around ADSBexchange via RapidAPI (an unofficial, community-sourced ADS-B aggregator). We're switching to Flightradar24's official API for several reasons:

- **First-party, documented API** with official SDKs, sandbox environment, and support
- **Richer data**: flight summary gives `orig_iata`/`dest_iata` directly (no need for ICAO→IATA lookup table)
- **Flight search by number** via the Summary endpoint is purpose-built for our use case
- **Historic Flight Events** endpoint provides sparse, meaningful waypoints (airspace crossings, takeoff, landing) — ideal for our globe-scale visualization
- **Official JS SDK** available (`@flightradar24/fr24api-sdk-js`), though we may not use it (see §4.4)

### Key Design Decision: Events over Tracks

The FR24 API offers a **Flight Tracks** endpoint (40 credits/call, returns thousands of ADS-B positions) and a **Historic Flight Events** endpoint (2–3 credits/event, returns operational milestones). For lightpath's globe-scale visualization, full track resolution is unnecessary — we need the route's *shape*, not every GPS ping. The events endpoint returns exactly the sparse waypoints we need (takeoff, airspace crossings, descent, landing) at a fraction of the cost, and we interpolate a smooth curve between them client-side using the existing CatmullRomCurve3 pipeline.

This produces the aesthetic we want: large, smooth curves that show how a flight actually navigated airspace, rather than a jagged high-resolution trail. The airspace transition events capture precisely the points where a flight deviates from the great circle — flight corridor entry/exit, FIR boundary crossings — which are the most visually significant waypoints at global scale.

---

## 2. API Reference

### Service

- **Provider**: Flightradar24 (official)
- **Portal**: https://fr24api.flightradar24.com
- **API Base URL**: `https://fr24api.flightradar24.com/api`
- **Authentication**: Bearer token in `Authorization` header
- **Required header**: `Accept-Version: v1`
- **Sandbox**: Available for testing without consuming credits

### Subscription Tiers

| Tier | Price | Credits/month | Rate limit | History depth |
|---|---|---|---|---|
| Explorer | $9/month | 30,000 | 10 queries/min | 30 days |
| Essential | $90/month | 333,000 | 30 queries/min | 2 years |
| Advanced | $900/month | 4,050,000 | 90 queries/min | Unlimited |

**Decided**: Explorer tier ($9/month) for both development and initial production. The 30-day history limit is sufficient — we only look up the most recent instance of a flight, and most commercial flights operate daily or multiple times per week. If a flight is not found within the 30-day window, the app falls back gracefully to a great circle route between the airports. Essential tier ($90/month) is a future option if we ever need deeper history.

### Endpoints We Use

#### 2.1 Flight Summary Light

```
GET /api/flight-summary/light
```

**Purpose**: Search for a flight by number, get metadata and FR24 ID.

**Parameters** (date range mode — at least one primary parameter set required):
| Name | Type | Description |
|---|---|---|
| `flight_datetime_from` | string | Start of range (UTC). Format: `YYYY-MM-DDTHH:MM:SS`. Max 14-day window. |
| `flight_datetime_to` | string | End of range (UTC). |
| `flights` | string | Comma-separated flight numbers. Max 15. Example: `KL1613,BA117` |
| `sort` | string | `asc` or `desc` (by `first_seen`). Default: `asc` |
| `limit` | integer | Max results (up to 20,000). |

**Response fields**:
| Field | Description |
|---|---|
| `fr24_id` | Unique flight leg identifier (hex) — needed for Events lookup |
| `flight` | Commercial flight number (e.g., `KL1613`) |
| `callsign` | ATC callsign |
| `operating_as` | ICAO code of operating airline |
| `painted_as` | ICAO code of marketing airline |
| `type` | ICAO aircraft type designator (e.g., `B789`) |
| `reg` | Aircraft registration |
| `orig_icao` | ICAO code for origin airport |
| `datetime_takeoff` | Takeoff time (UTC, ISO 8601) |
| `dest_icao` | ICAO code for intended destination |
| `dest_icao_actual` | Actual destination (if diverted) |
| `datetime_landed` | Landing time (UTC, ISO 8601) |
| `hex` | 24-bit Mode-S identifier |
| `first_seen` | First ADS-B detection (UTC) |
| `last_seen` | Last ADS-B detection (UTC) |
| `flight_ended` | Boolean — `true` if historical, `false` if still tracked |

**Credit cost**: 1 credit (live), 2 credits (historic < 30 days), 3 credits (historic > 30 days)

#### 2.2 Historic Flight Events Light

```
GET /api/historic/flight-events/light
```

**Purpose**: Get operational milestone waypoints for a specific flight.

**Parameters**:
| Name | Type | Description |
|---|---|---|
| `flight_ids` | string | Comma-separated `fr24_id` values. Max 15. |
| `event_types` | string | Comma-separated event types, or `all`. |

**Available event types**: `gate_departure`, `takeoff`, `cruising`, `airspace_transition`, `resuming_flightplan`, `descent`, `landed`, `gate_arrival`

**Response structure**:
```json
{
  "fr24_id": "35f2ffd9",
  "callsign": "KLM1613",
  "hex": "484141",
  "events": [
    {
      "type": "takeoff",
      "timestamp": "2026-03-15T10:22:43Z",
      "lat": 52.3086,
      "lon": 4.7639,
      "alt": 0,
      "gspeed": 155,
      "details": {
        "takeoff_runway": "36L"
      }
    },
    {
      "type": "airspace_transition",
      "timestamp": "2026-03-15T10:45:12Z",
      "lat": 52.8421,
      "lon": 3.2145,
      "alt": 34000,
      "gspeed": 480,
      "details": {
        "exited_airspace": "EHAA",
        "exited_airspace_id": "...",
        "entered_airspace": "EGTT",
        "entered_airspace_id": "..."
      }
    },
    // ... more airspace transitions ...
    {
      "type": "landed",
      "timestamp": "2026-03-15T18:15:30Z",
      "lat": 40.6413,
      "lon": -73.7781,
      "alt": 0,
      "gspeed": 140,
      "details": {
        "landed_icao": "KJFK",
        "landed_runway": "31L"
      }
    }
  ]
}
```

**Credit cost**: 2 credits per event (all our queries are < 30 days on Explorer tier)

**Expected event count**: A transatlantic flight typically yields 8–15 events (takeoff + 4–8 airspace crossings + cruising + descent + landing). Total cost: ~16–30 credits per flight lookup.

#### 2.3 Endpoints We Don't Use (and why)

| Endpoint | Credits | Why not |
|---|---|---|
| Flight Tracks | 40/flight | Overkill for globe-scale view. Returns thousands of ADS-B points we'd just simplify down anyway. |
| Historic Flight Positions Full | 8/flight | Returns snapshot positions at a given timestamp, not a complete flight track. Different use case. |
| Flight Summary Full | 3–6/result | Full variant adds `orig_iata`, `dest_iata`, `flight_time`, `actual_distance`, `circle_distance`, `runway_takeoff`, `runway_landed`, `category`. We could use this if we need IATA codes directly, but our airport database already handles ICAO→IATA lookup. |

**Note**: Flight Summary Full may become useful later if we want to display `actual_distance` vs `circle_distance` in the UI, or show runway identifiers. Keep as a future option.

### 2.4 Credit Budget Estimate

Typical per-flight lookup: **4 (summary, limit=2) + ~18 (events) = ~22 credits** (confirmed with production data — events cost varies with event count, ~18 for a 15-event transatlantic flight, ~14 for shorter flights with fewer events)

On Explorer tier (30,000 credits/month): **~1,360 flight lookups/month**, costing ~$0.0066 each.

---

## 3. Architecture

### 3.1 Data Flow

#### Key architectural principle: route geometry vs. solar date

FR24 provides **route geometry** — the physical path a flight takes through airspace (waypoints, FIR crossings). This geometry is effectively stable for a given flight number: KL1613 crosses the same airspace boundaries month after month. The **solar illumination** (daylight, twilight, darkness along the route) depends on the date the user wants to visualize, which may be different from (or even in the future relative to) the date the route data was recorded.

Therefore the system separates these two concerns:
- **Route data** (from FR24, cached): waypoint lat/lon coordinates + relative time offsets from takeoff
- **Solar date** (from user): the date/time the user wants to simulate, applied client-side to the cached route geometry

This means a single cached route lookup can serve unlimited date variations without additional API calls.

#### Lookup flow

```
User enters flight number (e.g., "KL1613")
    ↓
Client checks in-memory session cache (Map keyed by flight number)
    ↓ (cache miss)
Client sends request to Vercel serverless function
    ↓
Serverless function checks Upstash Redis (persistent cache, shared across users, 30-day TTL)
    ↓ (cache miss)
Serverless function calls FR24 Flight Summary Light
    (with flight number + last 14 days date range, limit=2, sort=desc)
    ↓
Serverless function filters for flight_ended === true (skip in-flight legs)
    ↓
Returns fr24_id, airport ICAO codes, aircraft info
    ↓
Serverless function calls FR24 Historic Events Light
    (with fr24_id, event_types=all)
    ↓
Returns array of event waypoints (lat/lon/alt/timestamp)
    ↓
Serverless function computes relative time offsets (ms from takeoff for each event),
    stores summary + events + offsets in Upstash Redis (TTL 30 days),
    returns combined payload to client
    ↓ (cache hit at any level skips to here)
Client receives route data: airports, waypoints, relative timing profile
    ↓
Client displays flight card with metadata, user picks date/time and confirms
    ↓
Client builds control points array:
  - First point: origin airport coords (from local airport dataset)
  - Middle points: events with lat/lon (cruising, airspace_transition, descent)
  - Last point: destination airport coords (from local airport dataset)
  - Each point carries a relative time offset (ms from takeoff)
    ↓
latLonToVector3() converts to 3D sphere coordinates
    ↓
CatmullRomCurve3 interpolates smooth curve through control points
    ↓
All sampled points normalized to sphere radius (2.01) to prevent ocean gaps
    ↓
Arc-length fractions computed for each control point via curve.getLengths()
    ↓
getPointAt() (arc-length parameterized) samples 101 evenly-spaced points
    ↓
TubeGeometry renders the flight path (same pipeline as great circle)
    ↓
Sun angle colors calculated using user-chosen departure date/time
    + relative offsets interpolated via interpolateTimestamp()
    ↓
Plane animation uses getPointAt()/getTangentAt() for correct speed
```

### 3.2 Server-Side Proxy (Required)

The FR24 API token must never be exposed in client-side code. We use Vercel serverless functions as a thin proxy + cache layer.

**Files**:
```
api/
├── flight-lookup.js         # Merged function: summary + events + Upstash Redis cache (implemented)
├── flight-search.js         # Legacy: proxies Flight Summary Light (deprecated, kept for reference)
└── flight-events.js         # Legacy: proxies Historic Flight Events Light (deprecated, kept for reference)
```

The merged `flight-lookup.js` handles the full flow in one call: check Upstash Redis cache → on miss, fetch summary + events from FR24 → compute relative offsets → store in Redis → return combined payload. See §8.2 for cache architecture details.

**Why Vercel Functions**: Lightpath already deploys on Vercel. Functions are zero-config, auto-deployed from the `api/` directory, and share the same domain (no CORS issues).

**Environment variables** (Vercel project settings):
- `FR24_API_TOKEN` — Bearer token for FR24 API
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` — auto-set when Upstash Redis store is connected to the Vercel project via the Vercel Marketplace integration

### 3.3 New Client-Side Files

```
src/
├── services/
│   └── fr24.js              # Client-side API calls with in-memory session cache
├── utils/
│   └── routeInterpolation.js # Event waypoints → smooth curve control points
```

### 3.4 Modified Files

```
src/
├── App.jsx                   # searchMode state, callsign state, handleCallsignSearch(),
│                             # handleCallsignStart() (uses relative offsets + user-chosen date),
│                             # rendering branch (SLERP vs CatmullRom),
│                             # airportsIcao lookup, callsignControlPointsRef,
│                             # deep-link useEffect for /flight/:callsign/:date/:time
├── App.css                   # (pending) New UI element styles for callsign mode
├── components/
│   └── FlightInputPanel.jsx  # Header mode toggle, callsign input/FIND flow, resolved airports
│                             # display, error state + dismiss, editable datetime pill, START button
```

### 3.5 State Management

**New state variables** (in App.jsx):
```javascript
const [searchMode, setSearchMode] = useState('route')                  // 'route' | 'callsign'
const [callsignInput, setCallsignInput] = useState('')                 // flight number text
const [callsignSearchResult, setCallsignSearchResult] = useState(null) // combined lookup data (summary + events + offsets)
const [callsignError, setCallsignError] = useState(null)               // error message string
const [isCallsignSearching, setIsCallsignSearching] = useState(false)  // loading state
const [pendingCallsignStart, setPendingCallsignStart] = useState(false) // auto-start after deep-link search completes
const callsignControlPointsRef = useRef(null)                          // control points for rendering
const callsignArcLengthFractionsRef = useRef(null)                     // per-control-point arc-length fractions
```

**Note**: The original `callsignEvents` state (which stored the raw events array separately) was merged into `callsignSearchResult`, which holds the combined payload from `flight-lookup.js` (summary, events with relative offsets, total duration, typical departure time). This simplified the two-step search→start flow into a single `lookupFlight()` call that returns everything needed. The `pendingCallsignStart` flag enables the deep-link auto-start flow: when a URL like `/flight/KL1613/2026-06-21/1022` is opened, the search is triggered and `pendingCallsignStart` is set to `true`; a separate useEffect watches for it and auto-triggers `handleCallsignStart()` once the search result arrives.

**Naming convention**: We use "callsign" in the codebase (not "flight") to avoid collision with existing flight-related variables (`flightPath`, `flightResults`, `FlightInputPanel`, etc.). The UI shows "Flight" to the user.

### 3.6 SDK Decision

We choose **not to use the FR24 JS SDK** (`@flightradar24/fr24api-sdk-js`) for the initial implementation. The SDK is designed for Node.js environments and wraps the REST API with a typed client. Since our API calls happen inside Vercel serverless functions (which are Node.js), the SDK would technically work there. However, for two straightforward GET requests with a Bearer token, raw `fetch` is simpler and avoids adding a dependency. We define our own minimal TypeScript-style JSDoc types based on the known response shapes.

If the server-side logic grows more complex later (multiple query patterns, rate limit retry logic, batch queries), we can adopt the SDK then.

---

## 4. Client-Side Route Interpolation

### 4.1 From Events to Smooth Curve

The Historic Events endpoint returns sparse waypoints at operationally significant locations. We convert these into a smooth 3D curve for rendering:

```
Raw events (8–15 points)
    ↓
Filter to position-bearing events (exclude gate events without lat/lon)
    ↓
Sort by timestamp
    ↓
Convert each {lat, lon} to Vector3 via latLonToVector3(lat, lon, 2.01)
    ↓
Create CatmullRomCurve3(controlPoints, closed=false, 'catmullrom', tension)
    ↓
Sample 100 equidistant points along the curve
    ↓
Feed into existing TubeGeometry + vertex color pipeline
```

### 4.2 Sun Angle Calculation

With event waypoints, sun angle calculation becomes *more accurate* than with the great circle approach:

- Great circle mode estimates time at each point using a constant 750 km/h speed assumption
- Events mode has **real relative timing** at control points (offsets from takeoff), and we interpolate timestamps using arc-length-aware waypoint mapping

**Relative timing model**: The cached route data stores `offsetMs` (milliseconds from takeoff) for each waypoint, not absolute timestamps. At render time, the client combines these offsets with the user-selected departure date/time:

```
absoluteTime = userChosenDepartureTime + offsetMs
```

This means the same cached route data produces correct solar illumination for any date the user selects.

**Implementation**: `interpolateTimestamp(controlPoints, fraction, arcLengthFractions)` takes the arc-length fraction (0.0–1.0), finds which two control points it falls between (using `arcLengthFractions` computed from `curve.getLengths()`), then linearly interpolates the timestamp within that segment. The control points carry absolute timestamps (computed from user-chosen departure time + cached offsets) before being passed to this function.

This means: between Europe (dense waypoints, short intervals) and the Atlantic (sparse waypoints, long intervals), the time mapping is accurate to each segment. The daylight/twilight/darkness color bands on the tube will reflect the correct solar position for the user's chosen date.

### 4.5 Sphere Surface Normalization

CatmullRom interpolation operates in Cartesian 3D space. When control points are far apart on a sphere (e.g., separated by an ocean with no intermediate waypoints), the interpolated path cuts through the interior of the sphere rather than following the surface. This causes visible gaps in the tube where it dips below the globe.

**Fix**: All points sampled from the CatmullRom curve in callsign mode are normalized back to the sphere surface: `point.normalize().multiplyScalar(radius)`. This applies to the 101 tube points, the 800 progress tube points, the 2000 daylight sampling points, and plane/label positions in the animation loop.

### 4.3 Tension Parameter

The CatmullRomCurve3 `tension` parameter controls how tightly the curve follows the control points. For flight paths:
- `tension = 0.0` (Catmull-Rom default): gentle, natural-looking curves
- `tension = 0.5`: tighter adherence to control points

We'll start with `0.0` (default Catmull-Rom) and tune visually during sandbox testing. The goal is smooth, flowing curves that look intentionally designed — not artificially sharp at waypoints.

### 4.4 Spherical Interpolation Consideration

CatmullRomCurve3 interpolates in Cartesian 3D space, which for points on a sphere is close to but not exactly a great circle between consecutive waypoints. At globe scale with control points separated by hundreds of kilometers, this difference is visually negligible — the tube sits at radius 2.01 and the camera is at 2.3–3.5, so sub-degree deviations are invisible. If needed later, we can implement spherical CatmullRom interpolation, but it's almost certainly unnecessary.

---

## 5. UX Design

### 5.1 Dual Mode Interaction

The app preserves both modes of interaction:

**Mode A — Great Circle Route** (existing):
- User enters departure and arrival airports
- App calculates great circle path and sun-angle colors
- No API call needed

**Mode B — Flight Search** (new):
- User enters a flight number
- App fetches the most recent instance of that flight
- Displays flight card with metadata (route, date, aircraft)
- User confirms → app fetches events → draws interpolated route

### 5.2 Mode Switching

**Decided**: Option A — clickable words in the panel header: "Search **Route** or **Flight**". Active mode at opacity 1, inactive at 0.4, hover at 0.7. Clicking resets all callsign/route state. Implemented.

### 5.3 Flight Card

When a flight is found, display the resolved airports in the same FROM/TO layout as route mode, using `airportsIcao` lookup. All fields display-only (not editable). No swap button. Aircraft type from Summary response shown alongside flight number (future enhancement).

### 5.4 Date/Time Selection in Callsign Mode

**Key UX decision**: The datetime pill in callsign mode is **editable**, not locked to the real takeoff date. This is because lightpath separates route geometry (from FR24 data) from solar date (user's choice):

- After FIND returns a result, the datetime pill auto-fills with the cached flight's typical departure time (from the most recent real instance). This serves as a sensible default.
- The user can change the date to any date — past, present, or future — to see how daylight/twilight/darkness shifts along that route across seasons.
- The time field defaults to the real departure time (e.g., 10:22 for a morning flight) since departure times are typically stable for a given flight number.
- Changing the date/time only affects the solar illumination calculation — the route geometry stays the same.

**Implementation**: `handleCallsignStart()` uses the user-selected `departureTime` state (from the datetime pill) as the base, then applies the cached relative time offsets to compute the absolute timestamp at each waypoint for sun angle calculation.

### 5.5 Deep-Link URLs

**Callsign mode URL format**: `/flight/{flightNumber}/{date}/{time}`

Examples:
- `/flight/KL1613/2026-06-21/1022` — KL1613 on June 21 at 10:22
- `/flight/SQ25/2026-12-15/2330` — SQ25 on December 15 at 23:30

When a deep link is opened:
1. Parse flight number, date, and time from URL
2. Set `searchMode` to 'callsign', populate `callsignInput`
3. Set `departureTime` from the URL's date/time
4. Trigger `handleCallsignSearch()` → on success, auto-trigger `handleCallsignStart()`
5. The route renders with the URL-specified date for solar calculations

**Backward compatibility**: The short form `/flight/KL1613` (without date/time) still works — defaults to today's date and the cached flight's typical departure time.

**Route mode URL format** (unchanged): `/flight/{from}-{to}/{date}/{time}` (e.g., `/flight/AMS-JFK/2026-03-15/1022`)

### 5.6 Loading & Error States

- **Searching**: Subtle loading indicator in the search field
- **No results**: Flight not found in last 30 days → fall back to great circle route. If the user entered a valid flight number, attempt to resolve origin/destination airports from the flight number pattern and calculate a great circle route instead. Display a subtle note: "No recent flight data found — showing great circle route."
- **API error**: "Unable to fetch flight data. Please try again."
- **Rate limited** (HTTP 429): "Too many requests. Please wait a moment."
- **No events / insufficient events**: Fallback to great circle between the Summary's origin/destination airports (we still have `orig_icao`/`dest_icao` from the Summary response)

### 5.7 Animation Controls

Once a flight route is rendered, the existing AnimationControls component works unchanged — it animates the tube's `drawRange` to reveal the path progressively. The flight duration comes from the cached relative timing profile (total duration = last offset), and daylight/darkness stats are recalculated based on the user-selected date.

---

## 6. Git & Development Setup

### 6.1 Branch Strategy

**Decided**: Three-branch model.

- **`master`** — Production. What's live on lightpath.cc (currently v0.9.6). Only receives merges from `dev` (hotfixes) or `v1.0.0-dev` (when ready for release).
- **`dev`** — Maintenance branch for the current app. Hotfixes, minor improvements, patches (v0.9.7, v0.9.8, etc.). Merged into `master` as needed.
- **`v1.0.0-dev`** — The FR24 integration branch. All API work, serverless functions, UX changes, and new rendering modes accumulate here. Merged into `master` when v1.0.0 is ready for release.

**Sync strategy**: Periodically merge `dev` into `v1.0.0-dev` to incorporate any hotfixes or improvements made to the current app. Conflict surface should be small since FR24 work is mostly new files (`api/`, `fr24.js`, `routeInterpolation.js`) plus modifications to `FlightInputPanel.jsx` and `App.jsx`.

**Why `v1.0.0-dev` over `feature/fr24-integration`**: This isn't a single feature — it's a collection of changes (API layer, serverless functions, UX redesign, new rendering mode) that together constitute the v1.0.0 release. The branch name makes the intent clear.

### 6.2 Environment Configuration

**Local development** (`.env.local`, gitignored):
```
FR24_API_TOKEN=your_sandbox_token_here
```

**Vercel production + preview** (project settings → Environment Variables, set via `vercel env add`):
```
FR24_API_TOKEN=019cfba4-b86b-711b-a10e-...  (production Explorer token, named "lightpath")
```
Token is set for both Production and Preview environments in Vercel project settings.

### 6.4 Local Development

**Option A — `vercel dev`**: Serves both Vite frontend and serverless functions. Requires `vercel login` + project linking (`vercel link`). Reads env vars from Vercel project settings. Known issue: `vercel dev` + Vite 7.2 has routing bugs (SPA rewrite causes `index.html` to be parsed as JS). Partially mitigated by `vercel.json` rewrite change but may still be unreliable.

**Option B — `npm run dev` with Vite custom middleware** (recommended, implemented): `vite.config.js` uses a custom `configureServer` middleware plugin (named `flight-lookup-proxy`) that intercepts `/api/flight-lookup` requests. The middleware replicates the full `api/flight-lookup.js` logic locally: calls FR24 Flight Summary Light (with `flight_ended === true` filter), then FR24 Historic Events Light, computes `offsetMs` relative offsets, extracts `typicalDepartureTimeUtc`, and returns the combined payload. This ensures local dev behavior matches production closely. The only difference is **no Upstash Redis cache** — local dev always hits FR24 live. The old `/api/flight-search` and `/api/flight-events` proxy rules have been removed.

**Important**: The Vite middleware reads `FR24_API_TOKEN` from `.env.local` via `loadEnv()`. After `vercel env pull`, the token may be wrapped in quotes — the Vite `loadEnv` function handles this correctly.

### 6.3 Gitignore Additions

```
# API keys
.env.local

# Vercel
.vercel
```

---

## 7. Implementation Phases

### Phase 1: Sandbox Validation (Before Writing Code) ✅

- [x] Sign up for FR24 API account
- [x] Get sandbox token
- [x] Test Flight Summary Light — works, sandbox returns stub data (SK1415 ARN→CPH) regardless of query
- [x] Test Historic Flight Events Full & Light — both work at `/api/historic/flight-events/{full|light}`
- [x] Confirm airspace transition events contain lat/lon — **confirmed**: `cruising`, `descent`, `airspace_transition` events have top-level `lat`, `lon`, `alt`, `gspeed`
- [x] Document event lat/lon availability — `gate_departure`, `takeoff`, `landed` do NOT have top-level lat/lon; `gate_arrival` has lat/lon nested in `details`
- [x] Decide: Events Light vs Full — **Events Light is sufficient**. The only difference is Full adds `operating_as`, `painted_as`, `orig_iata`, `orig_icao`, `dest_iata`, `dest_icao` to the wrapper object. Since we already get airport codes from Flight Summary, Light saves credits.

**Sandbox findings — waypoint enrichment needed**: Events without lat/lon (takeoff, landed) must be enriched with airport coordinates. Since the app already loads a complete airport dataset for rendering airport dots on the globe, we use that local data — no additional API call needed. At globe scale (radius 2.0), the distance between a gate, runway, and airport reference point is invisible, so a single coordinate per airport suffices for all ground-side events.

The interpolation pipeline becomes:
1. Origin airport lat/lon (from **local airport dataset**) → first control point
2. Events with lat/lon (cruising, airspace_transitions, descent) → middle control points
3. Destination airport lat/lon (from **local airport dataset**) → last control point

Flight Summary Light is only needed to obtain the `fr24_id` and confirm the flight exists within the 30-day window. Airport positioning is handled entirely client-side.

**Production data test results** (2026-03-17, Explorer tier):

| Flight | Route | Total events | Events with lat/lon | Usable control points (incl. airports) |
|---|---|---|---|---|
| KL605 | AMS→SFO (long-haul) | 7 | 5 | 7 |
| SQ25 | FRA→SIN (ultra long-haul, in-flight) | 8 | 7 | 9 |
| KL1009 | AMS→LHR (short-haul) | 6 | 3 | 5 |
| SQ25 | JFK→FRA (long-haul, completed) | 15 | 12 | 14 |

**Key findings**:
- `airspace_transition` events always have lat/lon — these are the primary routing waypoints
- `cruising` and `descent` also have lat/lon — useful additional shape points
- `takeoff`, `landed`, `gate_arrival` never have top-level lat/lon — enriched from local airport dataset
- Long-haul flights produce 4–7 airspace transitions; short-haul as few as 1
- Short-haul routes (1 transition) will produce curves very close to great circle — acceptable, since the real path barely deviates at that distance
- **Revised credit cost**: ~16 credits/flight (2 summary + 14 events), not ~22 as estimated. ~1,875 lookups/month on Explorer.

### Phase 2: Server-Side Proxy ✅

- [x] Create `api/flight-search.js` Vercel function — proxies `/flight-summary/light`, builds 14-day UTC window, requests `limit=2` + `sort=desc`, filters server-side for `flight_ended === true` to ensure only completed flights are returned
- [x] Create `api/flight-events.js` Vercel function — proxies `/historic/flight-events/light`, takes `fr24_id`, requests `event_types=all`
- [x] Implement token management — reads `FR24_API_TOKEN` from environment, Bearer auth + `Accept-Version: v1`
- [x] Add error handling — 400 for missing params, forwards FR24 status codes verbatim, 502 on network failure
- [x] CORS preflight handling — both functions respond to OPTIONS with 204
- [x] Test with production token — real data confirmed (see findings above)

### Phase 3: Client-Side API Service ✅

- [x] Create `src/services/fr24.js` — originally two async functions (`searchFlight`, `getFlightEvents`), now refactored to single `lookupFlight()` function calling merged `/api/flight-lookup` endpoint with in-memory session cache (`Map`)
- [x] Create `src/utils/routeInterpolation.js` — `buildControlPoints(events, depAirport, arrAirport)` builds ordered waypoint array (airport coords + events with lat/lon). `interpolateTimestamp(controlPoints, fraction, arcLengthFractions)` performs waypoint-aware timestamp interpolation: finds which segment the fraction falls in using per-control-point arc-length fractions, then linearly interpolates within that segment. Falls back to simple first-to-last linear interpolation when `arcLengthFractions` is omitted (route mode).
- [x] Add ICAO-keyed airport lookup (`airportsIcao` state) in App.jsx alongside existing IATA-keyed map — built from same `/airports.json` dataset, no additional data needed
- [ ] Unit test interpolation with mock event data

### Phase 4: UI Integration ✅

**Completed:**
- [x] Add route mode state to App.jsx — `searchMode` state ('route' | 'callsign'), plus `callsignInput`, `callsignSearchResult`, `callsignError`, `isCallsignSearching`, `pendingCallsignStart` state variables
- [x] Header mode toggle — "Search **Route** or **Flight**" with clickable words, active at opacity 1, inactive at 0.4, hover at 0.7. Clicking resets all callsign state.
- [x] Callsign input panel — single centered "FLIGHT" label + input field (replaces From/To in callsign mode), FIND button below. Input auto-uppercases, submits on Enter.
- [x] Search result display — resolved airports shown in same FROM/TO layout as route mode, using `airportsIcao` lookup. All fields display-only (not editable). No swap button.
- [x] Error state — error message + dismiss (×) button, returns to input on close
- [x] Action row in callsign mode — datetime pill auto-filled from `datetime_takeoff` via Luxon. START button wired to `handleCallsignStart`. **Note**: datetime pill was initially disabled/greyed out; will be made editable in Phase 4b (see §5.4).
- [x] Button text: "CALCULATE" in route mode, "START" in callsign mode
- [x] `handleCallsignSearch()` — async function calls `lookupFlight()`, sets result or error, manages loading state with try/finally. Auto-fills `departureTime` from `typicalDepartureTimeUtc` in the response.
- [x] `handleCallsignStart()` — uses relative offsets from cached data + user-chosen departure date/time to build control points with absolute timestamps (`baseTime + event.offsetMs`). Builds CatmullRom curve, samples 2000 points for daylight stats using `interpolateTimestamp()`, then triggers same rendering pipeline as route mode. Sets `departureCode`/`arrivalCode`/`departureAirport`/`arrivalAirport` state from resolved ICAO airports. Updates URL to `/flight/{callsign}/{date}/{time}` after rendering.
- [x] Rendering branch in useEffect — if `callsignControlPointsRef.current` is set, builds CatmullRom curve from event control points and samples 101 positions using `getPointAt()` (arc-length parameterization); otherwise uses existing SLERP great circle with `getPoint()`.
- [x] Arc-length parameterization — all callsign mode curve sampling uses `getPointAt()`/`getTangentAt()` for uniform geographic distribution. `arcLengthFractions` array computed via `curve.getLengths()` and stored in `callsignArcLengthFractionsRef`.
- [x] Waypoint-aware timestamp interpolation — `interpolateTimestamp()` upgraded to accept `arcLengthFractions`, finds the correct segment between control points and interpolates within it. Ensures sun angle at each tube segment uses the real time the plane was there.
- [x] `isCallsignMode` flag stored on `flightGroup.userData` — animation loop uses `getPointAt`/`getTangentAt` for plane and transition labels in callsign mode, `getPoint`/`getTangent` in route mode.
- [x] Route mode isolation — `calculateFlight()` clears `callsignControlPointsRef` and `callsignArcLengthFractionsRef` to ensure rendering useEffect takes SLERP branch.
- [x] URL update — callsign mode navigates to `/flight/${callsignInput}`. Route added to React Router (`/flight/:callsign`).
- [x] Sphere normalization — all CatmullRom sampled points in callsign mode normalized to `radius` (2.01) to prevent path dipping inside globe over ocean gaps.

**Remaining:**
- [ ] CSS refinement for callsign mode UI elements (both color and B&W modes)
- [ ] Visual testing and debugging (see known bugs below)

**Bugs fixed and verified (2026-03-20):**

1. **Airport labels blank in callsign mode** — ✅ VERIFIED. `handleCallsignStart` sets `departureCode`/`arrivalCode`/`departureAirport`/`arrivalAirport` from resolved ICAO airports. Globe labels render correctly.

2. **Route mode broken after callsign mode** — ✅ VERIFIED. `calculateFlight()` clears `callsignControlPointsRef.current` and `callsignArcLengthFractionsRef.current`. Mode switching works correctly.

3. **Path gaps on ocean crossings** — ✅ VERIFIED. Sphere normalization (`.normalize().multiplyScalar(radius)`) applied to all CatmullRom sampled points. No visible gaps on transatlantic routes.

**Known issues / limitations:**

4. **Vite proxy `flight_ended` filter** — ✅ FIXED. The local dev Vite custom middleware (`vite.config.js`) now replicates the full `flight-lookup.js` logic including the `flight_ended === true` filter. Local dev behavior matches production. The only difference is no Upstash Redis cache locally — every search hits FR24 live.

5. **Callsign resolved airports display styling** — The resolved FROM/TO airports in callsign mode use inline `fontFamily: 'monospace'` styling (lines 304, 321 of FlightInputPanel.jsx) which doesn't match the route mode styling. Should use the same CSS classes as route mode's airport code display. Cosmetic issue for UI polish phase.

6. **`vercel.json` rewrite change** — Updated `/(.*) → /index.html` to `/((?!api/).*)` for `vercel dev` compatibility. This is a no-op in production (Vercel resolves functions before rewrites). Should be verified on production deploy.

7. **Serverless functions use `export default` (ES modules)** — Changed from `module.exports` (CommonJS) to `export default` due to `"type": "module"` in package.json. Works with both Vercel deployment and `vercel dev`. Verified.

### Phase 4b: Caching & Date-Independence ✅

- [x] Create `api/flight-lookup.js` — merged serverless function that handles both summary + events in a single call, with Upstash Redis cache layer (see §8.2). Uses `@upstash/redis` package.
- [x] Install `@upstash/redis` dependency (replaced original plan to use `@vercel/kv`, which was sunset)
- [x] Compute and store `offsetMs` (relative timing) instead of absolute timestamps in cache payload
- [x] Extract `typicalDepartureTimeUtc` from real flight data for datetime defaults
- [x] Client-side in-memory cache (`Map`) in `fr24.js` — check before calling server
- [x] Update `src/services/fr24.js` — replaced `searchFlight()` + `getFlightEvents()` with single `lookupFlight()` function
- [x] Update `handleCallsignStart()` — uses relative offsets + user-chosen date (`baseTime + event.offsetMs`) instead of raw event timestamps
- [x] Make datetime pill editable in callsign mode (removed `opacity: 0.45` / `pointerEvents: 'none'`). Date and time both editable, showing UTC for callsign mode.
- [x] Update Vite middleware to handle `/api/flight-lookup` — custom `configureServer` middleware replicates full flight-lookup logic locally (no cache)

### Phase 4c: Deep-Link & URL Routing ✅

- [x] Update URL format: `/flight/{flightNumber}/{date}/{time}` (e.g., `/flight/KL1613/2026-06-21/1022`)
- [x] Add `useEffect` to parse URL params and auto-trigger search+start flow. Disambiguates route mode (`AMS-JFK`) from callsign mode (`KL1613`) using hyphen + 3-letter code detection: `segment.includes('-') && segment.split('-').length === 2 && segment.split('-').every(part => part.length === 3)`. Uses `pendingCallsignStart` flag for auto-start after search completes.
- [x] Support short form `/flight/KL1613` (without date/time) — defaults to today + `typicalDepartureTimeUtc`. Fixed param check to use `params.segment1 || params.callsign` since short-form URL matches `:callsign` route param.
- [x] Ensure `handleCallsignStart()` updates URL with the user-selected date/time after rendering: `navigate(\`/flight/${callsignInput}/${dt.toFormat('yyyy-MM-dd')}/${dt.toFormat('HHmm')}\`, { replace: true })`
- [x] Update `main.jsx` routes: `/flight/:segment1/:date/:time` and `/flight/:callsign`

### Phase 5: Testing & Polish

- [ ] Test with diverse flights (short-haul, long-haul, polar, domestic)
- [ ] Tune CatmullRom tension parameter
- [ ] Verify visual quality at different zoom levels
- [ ] Edge cases: diverted flights, cancelled flights, no events
- [ ] Performance: verify no rendering regression
- [ ] Capture/share: verify ShareButton works with event-based routes
- [ ] CSS refinement for callsign mode UI elements (both color and B&W modes)
- [ ] Graceful fallback when events are insufficient (great circle between Summary airports)
- [ ] Error differentiation (429 rate limit vs 5xx API error vs not found)

### Phase 6: Credit Monitoring (Post-Launch)

- [ ] Build credit usage tracking widget (macOS app or private web dashboard)
- [ ] FR24 Usage endpoint (`GET /api/usage`) provides 24h/7d/30d/1y reports
- [ ] Real-time credit balance display
- [ ] Alert thresholds for credit consumption

---

## 8. Caching Strategy

### 8.1 Why Caching Matters

At ~16 credits per flight lookup (revised estimate), caching is critical for credit conservation and performance. More importantly, because lightpath separates route geometry from solar date (see §3.1), a single cached route can serve unlimited date variations. The same KL1613 route data serves a user checking June solstice illumination and another checking December solstice — no additional API calls needed.

### 8.2 Two-Tier Cache Architecture

#### Tier 1: Client-Side Session Cache (in-memory)

```javascript
const flightCache = new Map()  // flightNumber → { summary, events, relativeOffsets, totalDurationMs, cachedAt }
```

- **Scope**: single browser tab, single session
- **TTL**: session-lived (clears on page reload)
- **Purpose**: avoid redundant API calls when the user searches the same flight multiple times in one session, or changes the date after already loading a flight
- **Cache key**: normalized flight number (uppercase, trimmed, e.g., `KL1613`)
- **Hit behavior**: skip server call entirely, go straight to route rendering with the user's chosen date

#### Tier 2: Upstash Redis (persistent, shared across users)

- **Provider**: Upstash Redis (via Vercel Marketplace integration). Note: the original plan was to use Upstash Redis, but Upstash Redis was sunset. Upstash Redis is the recommended replacement and is available as a first-party integration in the Vercel Marketplace. Uses `@upstash/redis` npm package.
- **Scope**: all users, all sessions, persists across deployments
- **TTL**: 30 days (matches Explorer tier history depth; route geometry doesn't change meaningfully within this window)
- **Cache key**: `flight:{normalized_flight_number}` (e.g., `flight:KL1613`)
- **Stored payload**:
```json
{
  "summary": {
    "flight": "KL1613",
    "orig_icao": "EHAM",
    "dest_icao": "KJFK",
    "dest_icao_actual": null,
    "type": "B789",
    "reg": "PH-BHA",
    "callsign": "KLM1613"
  },
  "events": [
    { "type": "takeoff", "lat": null, "lon": null, "offsetMs": 0 },
    { "type": "airspace_transition", "lat": 52.84, "lon": 3.21, "offsetMs": 1349000, "details": { ... } },
    ...
    { "type": "landed", "lat": null, "lon": null, "offsetMs": 28530000 }
  ],
  "totalDurationMs": 28530000,
  "typicalDepartureTimeUtc": "10:22",
  "cachedAt": "2026-03-17T14:30:00Z"
}
```
- **Key design**: events store `offsetMs` (milliseconds from takeoff) instead of absolute timestamps. This makes the cache date-independent — the same data works for any user-chosen departure date.
- **`typicalDepartureTimeUtc`**: extracted from the real flight's `datetime_takeoff`, stored as HH:MM. Used as a sensible default when the user hasn't selected a time (or arrives via a deep link without a time parameter).

#### How Tier 2 integrates with serverless functions

The two legacy serverless functions (`api/flight-search.js` and `api/flight-events.js`) have been superseded by **`api/flight-lookup.js`** which:

1. Receives `flight` query parameter (flight number)
2. Checks Upstash Redis for `flight:{number}`
3. On cache hit: returns cached payload immediately (0 FR24 credits), with `cached: true` in response
4. On cache miss:
   a. Calls FR24 Flight Summary Light (gets fr24_id, airports, aircraft)
   b. Calls FR24 Historic Events Light (gets waypoints)
   c. Computes `offsetMs` for each event relative to the first event's timestamp
   d. Extracts `typicalDepartureTimeUtc` from `datetime_takeoff`
   e. Writes combined payload to Upstash Redis with 30-day TTL
   f. Returns payload to client
5. On Redis failure: falls through to FR24 API (cache is an optimization, not critical path). The `redis` instance is conditionally created — if `KV_REST_API_URL` is not set (e.g., local dev), Redis is `null` and all cache operations are skipped gracefully.

**Why merge the two functions**: the client now makes one call instead of two sequential calls (search → events). With the cache, the server does both in one round-trip. The client calls one endpoint and gets everything it needs. This is also simpler for cache management — one key, one payload, one TTL.

The old `api/flight-search.js` and `api/flight-events.js` are kept for reference but are no longer called by the client.

#### Vite middleware for local development

The Vite config uses a custom `configureServer` middleware plugin (`flight-lookup-proxy`) that intercepts `/api/flight-lookup` requests and replicates the full serverless function logic: FR24 Summary + Events calls, `flight_ended` filtering, `offsetMs` computation, and `typicalDepartureTimeUtc` extraction. The local middleware does NOT use Upstash Redis — local dev always hits FR24 live. Acceptable for development, and the `flight_ended` filter ensures parity with production behavior.

### 8.3 Cache Economics

| Scenario | Credits/request | With cache |
|---|---|---|
| First lookup of a flight | ~16 | ~16 (cache miss) |
| Repeat lookup (same session) | ~16 | 0 (client-side hit) |
| Repeat lookup (different user, within 30 days) | ~16 | 0 (KV hit) |
| User changes date on same flight | ~16 | 0 (client-side hit, geometry unchanged) |

On Explorer tier (30,000 credits/month): without cache, ~1,875 unique lookups. With cache, 1,875 unique *flights* cached, serving unlimited requests per flight. The credit budget effectively becomes "number of distinct flight numbers searched per month" rather than "number of user requests."

### 8.4 Cache Invalidation

- **Client-side**: clears on page reload (acceptable — session-scoped by design)
- **Upstash Redis**: TTL-based, 30 days. No manual invalidation needed. If a flight changes its route (rare — airline route changes, new airspace agreements), the 30-day TTL ensures the cache refreshes naturally.
- **Force refresh** (future): optional `?refresh=1` query parameter on the serverless function to bypass cache. Useful for debugging or if a user reports stale data.

---

## 9. Risk Assessment

### High Risk
- **Event data quality**: Airspace transition events may not contain lat/lon for all flights → **Mitigation**: Sandbox testing first; fallback to great circle if events are insufficient
- **Credit costs scaling**: Popular app could exhaust credits quickly → **Mitigation**: Client-side caching, rate limiting in proxy, credit monitoring dashboard

### Medium Risk
- **Explorer tier 30-day limit**: Can only look up flights from last 30 days → **Mitigation**: Decided as acceptable. If flight not found, app falls back to great circle route. Most commercial flights operate daily, so 30 days is sufficient. Upgrade to Essential is a future option.
- **Event count variability**: Some flights may produce very few events (short domestic flights over a single FIR) → **Mitigation**: If < 3 events with lat/lon, fall back to great circle between origin/destination from Summary data

### Low Risk
- **Vercel Functions cold start**: First API call may be slightly slower → **Mitigation**: Acceptable latency for non-real-time use case
- **CatmullRom visual quality**: Cartesian interpolation on sphere surface → **Mitigated**: Solved by normalizing sampled points to sphere radius (2.01). Without normalization, CatmullRom creates chords through the globe interior between distant waypoints, causing visible path gaps over oceans. Fix applied; needs visual re-testing.

---

## 9a. Complete File Inventory (as of 2026-03-20)

### New files created:
```
api/flight-lookup.js           # Merged serverless function: summary + events + Upstash Redis cache (implemented)
api/flight-search.js           # Legacy: Vercel serverless proxy → FR24 Flight Summary Light (deprecated, kept for reference)
api/flight-events.js           # Legacy: Vercel serverless proxy → FR24 Historic Events Light (deprecated, kept for reference)
src/services/fr24.js           # Client-side API calls (lookupFlight with in-memory cache)
src/utils/routeInterpolation.js # buildControlPoints + interpolateTimestamp (with arc-length-aware interpolation)
tests/fr24-sandbox-test.mjs    # Standalone sandbox API test (not committed)
tests/fr24-production-test.mjs # Standalone production API test (not committed)
```

### Modified files:
```
src/App.jsx                    # searchMode state, callsign state/refs, handleCallsignSearch/Start,
                               # rendering branch (SLERP vs CatmullRom with getPointAt + sphere normalization),
                               # airportsIcao lookup, arc-length fractions, calculateFlight clears callsign refs,
                               # deep-link useEffect for /flight/:callsign/:date/:time,
                               # editable datetime pill in callsign mode,
                               # relative timing model (user-chosen date + offsets)
src/components/FlightInputPanel.jsx  # Header mode toggle, callsign input/FIND, resolved airports display,
                               # error state, editable datetime pill, CALCULATE/START conditional text
vite.config.js                 # Custom configureServer middleware for local dev (/api/flight-lookup)
vercel.json                    # SPA rewrite updated with negative lookahead to exclude /api/
src/main.jsx                   # Routes: /, /flight/:segment1/:date/:time, /flight/:callsign
.env.local                     # Production FR24 token + Vercel OIDC token (gitignored)
```

### Unchanged:
```
src/utils/geoUtils.js          # latLonToVector3 — used as-is
src/utils/solarUtils.js        # getSunAngle — used as-is
public/airports.json           # Airport dataset — used as-is (ICAO + IATA codes)
docs/api-plan-adsbexchange.md  # Alternative approach — untouched
```

---

## 10. Success Metrics

### Technical
- [ ] API success rate > 95% for flight lookups
- [ ] Average end-to-end latency < 3 seconds (search → route rendered)
- [ ] Credit cost per flight lookup < 30 credits on average
- [ ] No rendering performance regression vs great circle mode

### Visual
- [ ] Flight routes visibly deviate from great circle at global scale
- [ ] Smooth, flowing curves — no sharp angles at waypoints
- [ ] Sun-angle coloring accurate to real flight timestamps
- [ ] Indistinguishable quality from full-track rendering at default zoom

### UX
- [ ] Flight search intuitive — < 10 seconds from entering number to seeing route
- [ ] Error messages clear and actionable
- [ ] Mode switching seamless
- [ ] Works on mobile (responsive panel layout)

---

## 11. Open Questions

### Resolved During Testing
1. ✅ How many events does a typical transatlantic flight produce? → **15 events, 12 with lat/lon** (SQ25 JFK→FRA). Long-haul flights produce 7-15 events; 5-12 with lat/lon. Produces 7-14 usable control points including airport endpoints.
2. ✅ Do all `airspace_transition` events include lat/lon? → **Yes, always.** Confirmed across KL605, SQ25, KL1009 production data.
3. ✅ Short-haul event density → **KL1009 AMS→LHR**: 6 events, 3 with lat/lon, 5 control points total. Produces a curve very close to great circle — acceptable since the real path barely deviates at short distance.
4. ✅ Is `cruising` event useful? → **Yes** — has lat/lon, marks cruise altitude reached. Useful additional shape point.
5. `resuming_flightplan` — Not observed in any production test data. May be rare edge case (e.g., after holding patterns or diversions).

### To Resolve During UX Discussion
6. ✅ Mode switching UI → clickable "Route" / "Flight" words in panel header, toggling panel content
7. Should we show the great circle as a ghost/reference when displaying a flight route?
8. ✅ How to handle the flight card → resolved airports display inline in same panel (FROM/TO layout, display-only). No separate overlay or confirmation step for v1.
9. Should AnimationControls show real timestamps from events?
10. **Multi-leg flights sharing the same callsign**: Some airlines operate multi-leg services under a single flight number. Observed in production testing: SQ25 returned both JFK→FRA (leg 1) and FRA→SIN (leg 2), both filed as "SQ25". With our current `limit=2` + `flight_ended` filter, the proxy returns whichever leg completed most recently — the user has no control over which leg they get.

    **Scope of the problem**: This affects long-haul carriers that operate via hubs (Singapore Airlines, Emirates, Qatar Airways, etc.). Short-haul and point-to-point flights are unaffected. Need to investigate how common this pattern is.

    **Possible approaches to discuss**:
    - **Show route in flight card, let user confirm**: The card already shows origin→destination. If the user wanted the other leg, they see it's wrong and can search again — but there's no mechanism to request the other leg specifically.
    - **Disambiguation UI**: If `limit=2` returns two different routes for the same callsign, show both in the flight card and let the user pick. Requires increasing `limit` and comparing `orig_icao`/`dest_icao` across results.
    - **Accept the limitation for v1.0.0**: Always return the most recently completed leg. Document it as a known behavior. Revisit if users report confusion.
    - **Let user specify airports**: Allow optional departure/arrival airport input alongside the flight number to disambiguate. This could double as a fallback to great circle if the flight isn't found.

### To Resolve During Dev Setup Discussion
11. ✅ Branch strategy for v1.0.0 development → `master` / `dev` / `v1.0.0-dev` three-branch model
12. Staging/preview deployment strategy
13. Version numbering: what version is the FR24 integration? (v0.10.0? v1.0.0-beta?)

---

## 12. Future Enhancements (Post v1.0.0)

- **Alternative data provider**: The FR24-specific code is isolated in two serverless functions (`api/flight-search.js`, `api/flight-events.js`) and one client service (`src/services/fr24.js`). The rendering pipeline, interpolation logic, UI flow, and state management are all provider-agnostic — they just need `{ lat, lon, timestamp }` control points. Switching to another provider (e.g., OpenSky Network, ADSBexchange) would require rewriting only those three files plus a response adapter. The entire rendering stack, CatmullRom curve logic, arc-length parameterization, sun angle calculation, and UI carry over unchanged. Consider this if FR24 credit costs become prohibitive at scale.
- **Flight Summary Full**: Display actual vs great circle distance, runway identifiers, flight category
- **Multi-flight comparison**: Show two different flight routes overlaid on the globe
- **Route history**: Show how a flight number's route has changed over time (seasonal variations)
- **Credit monitoring widget**: macOS app or private dashboard for real-time API usage tracking
- **FR24 MCP integration**: Use FR24's MCP server for conversational flight data queries in development tooling
- **Flight Tracks upgrade**: Offer a "high detail" mode that fetches full Flight Tracks (40 credits) for users who want maximum fidelity

---

## 13. Reference Links

- FR24 API Portal: https://fr24api.flightradar24.com
- FR24 API Endpoints: https://fr24api.flightradar24.com/docs/endpoints/overview
- FR24 Flight Summary Docs: https://fr24api.flightradar24.com/docs/endpoints/flight-summary
- FR24 Credit Overview: https://fr24api.flightradar24.com/docs/credit-overview
- FR24 Historical Availability: https://fr24api.flightradar24.com/docs/endpoints/flight-positions-resolution
- FR24 JS SDK: https://github.com/Flightradar24/fr24api-sdk-js
- FR24 Python SDK: https://github.com/Flightradar24/fr24api-sdk-python
- FR24 MCP Server: https://github.com/Flightradar24/fr24api-mcp
- Lightpath Architecture: `docs/lightpath-architecture.md`
- Alternative API Plan (ADSBexchange): `docs/api-plan-adsbexchange.md`
