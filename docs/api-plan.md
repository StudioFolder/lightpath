# ADSBexchange API Integration Plan
**Project**: Lightpath  
**Feature**: Actual Flight Path Tracking  
**Version**: v0.6.0  
**Date**: 2026-02-09

---

## 1. Overview

### Goal
Allow users to search for a flight by number (e.g., "KL1613") and visualize the **actual flown route** from the most recent historical flight, instead of a theoretical great circle path.

### Key Benefits
- **Realistic visualization**: Show how flights actually navigate airspace
- **Educational**: Reveal weather avoidance, airspace restrictions, flight corridors
- **Comparative**: Users can toggle between planned (great circle) vs actual routes
- **No real-time complexity**: One-time API call per flight search

### User Flow
```
User selects "Actual Flight Path" mode
    ↓
Enters flight number: "KL1613"
    ↓
Clicks "Search Flight"
    ↓
API fetches most recent flight with that callsign
    ↓
Displays: "KL1613 - AMS → JFK (Last flown: Feb 8, 2026)"
    ↓
User clicks "Track This Flight"
    ↓
App draws actual waypoints colored by sun angle
```

---

## 2. API Research & Endpoints

### Service: ADSBexchange via RapidAPI
- **Base URL**: `https://adsbexchange-com1.p.rapidapi.com`
- **Authentication**: RapidAPI key in headers
- **Documentation**: https://rapidapi.com/adsbx/api/adsbexchange-com1

### Primary Endpoints

#### 2.1 Search by Flight Number
```
GET /v2/callsign/{callsign}/
```

**Purpose**: Find flights by callsign/flight number

**Request Example**:
```javascript
fetch('https://adsbexchange-com1.p.rapidapi.com/v2/callsign/KL1613/', {
  headers: {
    'X-RapidAPI-Key': 'YOUR_KEY',
    'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com'
  }
})
```

**Response Structure** (estimated):
```json
{
  "ac": [
    {
      "hex": "484141",
      "flight": "KL1613",
      "r": "PH-BHA",
      "t": "B789",
      "lat": 40.6413,
      "lon": -73.7781,
      "alt_baro": 0,
      "timestamp": 1707494400,
      "from": "EHAM",
      "to": "KJFK"
    }
  ],
  "total": 1,
  "ctime": 1707494500
}
```

#### 2.2 Get Flight Track/Route
```
GET /v2/icao/{icao24}/track/
```

**Purpose**: Get detailed position history for a specific aircraft

**Response Structure** (estimated):
```json
{
  "icao": "484141",
  "track": [
    {
      "lat": 52.3086,
      "lon": 4.7639,
      "alt_baro": 0,
      "timestamp": 1707480000
    },
    {
      "lat": 52.3156,
      "lon": 4.7012,
      "alt_baro": 1200,
      "timestamp": 1707480060
    },
    // ... hundreds more points
  ]
}
```

### 2.3 API Considerations

**Rate Limits**: TBD - need to check RapidAPI plan limits
**Cost**: Freemium model - need to verify free tier limits
**Data Freshness**: Historical data available for how many days?
**Point Density**: Expect 1 point every 5-60 seconds (needs simplification)

---

## 3. Technical Architecture

### 3.1 New Files to Create

```
src/
  services/
    adsbexchange.js          # API client
    pathSimplification.js    # Douglas-Peucker algorithm
  
.env.local                   # Store API key (gitignored)
```

### 3.2 Modified Files

```
App.jsx                      # Add flight search UI + logic
App.css                      # Style new UI elements
package.json                 # No new dependencies needed
```

### 3.3 State Management

**New State Variables** (in App.jsx):
```javascript
const [routeMode, setRouteMode] = useState('greatCircle') // 'greatCircle' | 'actualFlight'
const [flightNumber, setFlightNumber] = useState('')
const [flightSearchResults, setFlightSearchResults] = useState(null)
const [selectedFlight, setSelectedFlight] = useState(null)
const [isSearching, setIsSearching] = useState(false)
const [searchError, setSearchError] = useState(null)
```

**Data Flow**:
```
User Input (flightNumber)
    ↓
searchFlight() → ADSBexchange API
    ↓
flightSearchResults (flight metadata)
    ↓
User selects flight → selectedFlight
    ↓
fetchFlightTrack() → ADSBexchange API
    ↓
Raw track data (1000+ points)
    ↓
simplifyPath() → Douglas-Peucker
    ↓
Simplified waypoints (50-100 points)
    ↓
calculateFlightWithActualRoute()
    ↓
Existing rendering pipeline
```

---

## 4. Implementation Steps

### Phase 1: API Client (Day 1)

#### Step 1.1: Environment Setup
```bash
# Add to .env.local (create if doesn't exist)
VITE_RAPIDAPI_KEY=your_key_here
```

#### Step 1.2: Create API Service
**File**: `src/services/adsbexchange.js`

```javascript
const RAPIDAPI_KEY = import.meta.env.VITE_RAPIDAPI_KEY
const RAPIDAPI_HOST = 'adsbexchange-com1.p.rapidapi.com'

// Search for flights by callsign/flight number
export async function searchFlightByCallsign(callsign) {
  if (!RAPIDAPI_KEY) {
    throw new Error('RapidAPI key not configured')
  }

  const response = await fetch(
    `https://${RAPIDAPI_HOST}/v2/callsign/${callsign.toUpperCase()}/`,
    {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    }
  )

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }

  const data = await response.json()
  
  // Validate response
  if (!data.ac || data.ac.length === 0) {
    throw new Error('No flights found with this callsign')
  }

  return data
}

// Get detailed track for a specific aircraft
export async function getFlightTrack(icao24) {
  const response = await fetch(
    `https://${RAPIDAPI_HOST}/v2/icao/${icao24}/track/`,
    {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    }
  )

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`)
  }

  const data = await response.json()
  
  if (!data.track || data.track.length === 0) {
    throw new Error('No track data available for this flight')
  }

  return data
}

// Helper: Parse airport codes from ICAO format
export function parseAirportCode(icaoCode) {
  // ICAO codes are 4 letters, IATA codes are 3
  // E.g., "EHAM" → "AMS", "KJFK" → "JFK"
  // This is a simplified mapping - full implementation needs lookup table
  const icaoToIata = {
    'EHAM': 'AMS',
    'KJFK': 'JFK',
    'EGLL': 'LHR',
    'LFPG': 'CDG',
    // ... extend with full mapping
  }
  
  return icaoToIata[icaoCode] || icaoCode
}
```

### Phase 2: Path Simplification (Day 1)

#### Step 2.1: Douglas-Peucker Algorithm
**File**: `src/services/pathSimplification.js`

```javascript
/**
 * Douglas-Peucker algorithm for path simplification
 * Reduces number of points while preserving path shape
 * 
 * @param {Array} points - Array of {lat, lon, timestamp} objects
 * @param {Number} epsilon - Tolerance (in degrees, ~0.01 = 1km)
 * @returns {Array} Simplified array of points
 */
export function simplifyPath(points, epsilon = 0.05) {
  if (points.length <= 2) return points

  // Find point with maximum distance from line between first and last
  let maxDistance = 0
  let maxIndex = 0

  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    // Recursive call for points before maxIndex
    const leftSegment = simplifyPath(points.slice(0, maxIndex + 1), epsilon)
    // Recursive call for points after maxIndex
    const rightSegment = simplifyPath(points.slice(maxIndex), epsilon)

    // Concatenate results (remove duplicate maxIndex point)
    return leftSegment.slice(0, -1).concat(rightSegment)
  } else {
    // All points between first and last are close to the line
    // Return only endpoints
    return [first, last]
  }
}

/**
 * Calculate perpendicular distance from point to line
 * Using simplified formula for small distances on Earth
 */
function perpendicularDistance(point, lineStart, lineEnd) {
  const x = point.lat
  const y = point.lon
  const x1 = lineStart.lat
  const y1 = lineStart.lon
  const x2 = lineEnd.lat
  const y2 = lineEnd.lon

  // Calculate distance using cross product
  const numerator = Math.abs(
    (y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1
  )
  const denominator = Math.sqrt(
    Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2)
  )

  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Alternative: Simple uniform sampling
 * Use if Douglas-Peucker is too aggressive
 */
export function uniformSample(points, targetCount = 100) {
  if (points.length <= targetCount) return points

  const step = points.length / targetCount
  const sampled = []

  for (let i = 0; i < targetCount; i++) {
    const index = Math.floor(i * step)
    sampled.push(points[index])
  }

  // Always include last point
  sampled.push(points[points.length - 1])

  return sampled
}
```

### Phase 3: UI Updates (Day 2)

#### Step 3.1: Add Route Mode Toggle
**Location**: `App.jsx` - inside `.flight-input` panel

```jsx
{/* NEW: Route mode selector */}
<div className="route-mode-selector">
  <label className="radio-option">
    <input 
      type="radio"
      name="routeMode"
      value="greatCircle"
      checked={routeMode === 'greatCircle'}
      onChange={(e) => setRouteMode(e.target.value)}
    />
    <span>Great Circle (Planned)</span>
  </label>
  
  <label className="radio-option">
    <input 
      type="radio"
      name="routeMode"
      value="actualFlight"
      checked={routeMode === 'actualFlight'}
      onChange={(e) => setRouteMode(e.target.value)}
    />
    <span>Actual Flight Path</span>
  </label>
</div>

{/* Conditional rendering based on mode */}
{routeMode === 'greatCircle' ? (
  <>
    {/* Existing airport search inputs */}
    <div className="input-group">
      <label>Departure</label>
      {/* ... existing code ... */}
    </div>
  </>
) : (
  <>
    {/* NEW: Flight number search */}
    <div className="input-group">
      <label>Flight Number</label>
      <input 
        type="text"
        placeholder="e.g., KL1613"
        value={flightNumber}
        onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
      />
    </div>
    
    <button 
      onClick={handleSearchFlight}
      disabled={isSearching || flightNumber.length < 2}
    >
      {isSearching ? 'Searching...' : 'Search Flight'}
    </button>
    
    {searchError && (
      <div className="search-error">{searchError}</div>
    )}
    
    {flightSearchResults && (
      <div className="flight-results">
        <h4>Most Recent Flight:</h4>
        <div className="flight-card">
          <div className="flight-header">
            <span className="flight-number">{flightSearchResults.flight}</span>
            <span className="aircraft-type">{flightSearchResults.t}</span>
          </div>
          <div className="flight-route">
            {parseAirportCode(flightSearchResults.from)} → {parseAirportCode(flightSearchResults.to)}
          </div>
          <div className="flight-time">
            Last tracked: {new Date(flightSearchResults.timestamp * 1000).toLocaleString()}
          </div>
          <button onClick={handleTrackFlight}>
            Track This Flight
          </button>
        </div>
      </div>
    )}
  </>
)}
```

#### Step 3.2: Add CSS Styles
**Location**: `App.css`

```css
/* Route mode selector */
.route-mode-selector {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.radio-option input[type="radio"] {
  cursor: pointer;
  width: 16px;
  height: 16px;
  accent-color: #2d2e2f;
}

/* Flight search results */
.flight-results {
  margin-top: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.flight-results h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}

.flight-card {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 12px;
}

.flight-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.flight-number {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.aircraft-type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.flight-route {
  font-size: 16px;
  color: #fff;
  margin-bottom: 6px;
}

.flight-time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 12px;
}

.search-error {
  margin-top: 12px;
  padding: 10px;
  background: rgba(255, 100, 100, 0.2);
  border: 1px solid rgba(255, 100, 100, 0.3);
  border-radius: 6px;
  color: #ffcccc;
  font-size: 13px;
}

/* B&W mode overrides */
.bw-mode .route-mode-selector {
  background: rgba(0, 0, 0, 0.08);
}

.bw-mode .radio-option {
  color: rgba(40, 40, 40, 0.9);
}

.bw-mode .radio-option input[type="radio"] {
  accent-color: #282828;
}

.bw-mode .flight-results {
  background: rgba(0, 0, 0, 0.08);
}

.bw-mode .flight-card {
  background: rgba(0, 0, 0, 0.12);
}

.bw-mode .flight-number,
.bw-mode .flight-route {
  color: rgba(40, 40, 40, 0.9);
}

.bw-mode .aircraft-type,
.bw-mode .flight-time {
  color: rgba(40, 40, 40, 0.6);
  background: rgba(0, 0, 0, 0.1);
}
```

### Phase 4: Core Logic Integration (Day 2-3)

#### Step 4.1: Add Event Handlers
**Location**: `App.jsx`

```javascript
// Import new services
import { searchFlightByCallsign, getFlightTrack, parseAirportCode } from './services/adsbexchange'
import { simplifyPath } from './services/pathSimplification'

// Add state (at top with other useState declarations)
const [routeMode, setRouteMode] = useState('greatCircle')
const [flightNumber, setFlightNumber] = useState('')
const [flightSearchResults, setFlightSearchResults] = useState(null)
const [selectedFlight, setSelectedFlight] = useState(null)
const [isSearching, setIsSearching] = useState(false)
const [searchError, setSearchError] = useState(null)

// Add search handler
const handleSearchFlight = async () => {
  setIsSearching(true)
  setSearchError(null)
  setFlightSearchResults(null)
  
  try {
    const results = await searchFlightByCallsign(flightNumber)
    
    // Get most recent flight (first in array)
    const mostRecent = results.ac[0]
    
    setFlightSearchResults(mostRecent)
  } catch (error) {
    console.error('Flight search error:', error)
    setSearchError(error.message)
  } finally {
    setIsSearching(false)
  }
}

// Add track handler
const handleTrackFlight = async () => {
  if (!flightSearchResults) return
  
  try {
    // Fetch detailed track data
    const trackData = await getFlightTrack(flightSearchResults.hex)
    
    console.log('Raw track points:', trackData.track.length)
    
    // Simplify path (reduce from 1000+ to ~100 points)
    const simplified = simplifyPath(trackData.track, 0.05)
    
    console.log('Simplified to:', simplified.length, 'points')
    
    // Set airports based on flight data
    const depCode = parseAirportCode(flightSearchResults.from)
    const arrCode = parseAirportCode(flightSearchResults.to)
    
    if (!airports[depCode] || !airports[arrCode]) {
      setSearchError('Airport codes not found in database')
      return
    }
    
    setDepartureCode(depCode)
    setDepartureAirport(airports[depCode])
    setArrivalCode(arrCode)
    setArrivalAirport(airports[arrCode])
    
    // Set departure time from first track point
    const firstPoint = simplified[0]
    setDepartureTime(new Date(firstPoint.timestamp * 1000))
    
    // Store flight data with actual waypoints
    const flightData = {
      departure: airports[depCode],
      arrival: airports[arrCode],
      waypoints: simplified, // This is the key difference!
      flightNumber: flightSearchResults.flight,
      aircraftType: flightSearchResults.t
    }
    
    setSelectedFlight(flightData)
    
    // Trigger flight calculation with actual route
    calculateFlightWithActualRoute(flightData)
    
  } catch (error) {
    console.error('Track fetch error:', error)
    setSearchError(error.message)
  }
}
```

#### Step 4.2: Modify Path Drawing Logic
**Location**: `App.jsx` - modify `useEffect` that draws flight path

```javascript
useEffect(() => {
  if (!flightPath || !sceneRef.current) return

  // Remove previous flight path if exists
  if (flightLineRef.current) {
    sceneRef.current.remove(flightLineRef.current)
    flightLineRef.current.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) {
        if (child.material.map) child.material.map.dispose()
        child.material.dispose()
      }
    })
    flightLineRef.current = null
    hasFlightPathRef.current = false
  }

  const { departure, arrival, waypoints } = flightPath // waypoints is NEW

  const flightGroup = new THREE.Group()

  // Helper function (same as before)
  const latLonToVector3 = (lat, lon, radius) => {
    const phi = (90 - lat) * (Math.PI / 180)
    const theta = (lon + 180) * (Math.PI / 180)
    
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    )
  }

  // Generate 3D points - THIS IS THE KEY CHANGE
  const points = []
  const radius = 2.01
  
  if (waypoints && waypoints.length > 0) {
    // MODE 1: Use actual flight waypoints
    waypoints.forEach(wp => {
      points.push(latLonToVector3(wp.lat, wp.lon, radius))
    })
    
    console.log('Using actual flight path with', points.length, 'waypoints')
  } else {
    // MODE 2: Use great circle (existing code)
    const start = latLonToVector3(departure.lat, departure.lon, 1)
    const end = latLonToVector3(arrival.lat, arrival.lon, 1)
    const angle = start.angleTo(end)
    const numPoints = 100

    for (let i = 0; i <= numPoints; i++) {
      const fraction = i / numPoints
      const point = new THREE.Vector3()
      
      if (angle === 0) {
        point.copy(start)
      } else {
        const sinAngle = Math.sin(angle)
        const a = Math.sin((1 - fraction) * angle) / sinAngle
        const b = Math.sin(fraction * angle) / sinAngle
        
        point.x = a * start.x + b * end.x
        point.y = a * start.y + b * end.y
        point.z = a * start.z + b * end.z
      }
      
      point.normalize().multiplyScalar(radius)
      points.push(point)
    }
    
    console.log('Using great circle path with', points.length, 'points')
  }

  // Rest of the code continues exactly as before
  // The sun angle coloring works the same for both modes!
  
  // ... (all your existing path drawing code)
  
}, [flightPath, flightResults, departureTime, departureCode, arrivalCode])
```

#### Step 4.3: Create New Calculate Function
**Location**: `App.jsx`

```javascript
const calculateFlightWithActualRoute = (flightData) => {
  const { departure, arrival, waypoints } = flightData
  
  // Calculate total distance by summing waypoint-to-waypoint distances
  let totalDistance = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = haversineDistance(
      waypoints[i].lat, waypoints[i].lon,
      waypoints[i + 1].lat, waypoints[i + 1].lon
    )
    totalDistance += d
  }
  
  // Calculate flight duration from timestamps
  const firstPoint = waypoints[0]
  const lastPoint = waypoints[waypoints.length - 1]
  const durationMs = (lastPoint.timestamp - firstPoint.timestamp) * 1000
  const durationHours = durationMs / (1000 * 60 * 60)
  
  // Sample points to check day/night (same as existing code)
  let daylightSegments = 0
  let darknessSegments = 0
  const numSamples = waypoints.length // Use all waypoints
  
  waypoints.forEach((wp, i) => {
    const time = new Date(wp.timestamp * 1000)
    const inDaylight = isPointInDaylight(wp.lat, wp.lon, time)
    
    if (inDaylight) daylightSegments++
    else darknessSegments++
  })
  
  // Calculate daylight/darkness breakdown
  const totalFlightMins = Math.round(durationHours * 60)
  const daylightTotalMins = Math.round((daylightSegments / numSamples) * totalFlightMins)
  const darknessTotalMins = totalFlightMins - daylightTotalMins
  
  const results = {
    distance: Math.round(totalDistance),
    duration: durationHours.toFixed(1),
    durationHours: Math.floor(totalFlightMins / 60),
    durationMins: totalFlightMins % 60,
    daylightHours: Math.floor(daylightTotalMins / 60),
    daylightMins: daylightTotalMins % 60,
    darknessHours: Math.floor(darknessTotalMins / 60),
    darknessMins: darknessTotalMins % 60
  }
  
  setFlightResults(results)
  
  // Trigger path drawing with actual waypoints
  setFlightPath({ 
    departure, 
    arrival,
    waypoints // This is passed to the drawing effect
  })
  
  // Store flight data for animation
  flightDataRef.current = {
    departure,
    arrival,
    departureTime: new Date(firstPoint.timestamp * 1000),
    flightDurationMs: durationMs,
    waypoints
  }
  
  // Reset animation
  setAnimationProgress(0)
  animationProgressRef.current = 0
  
  // Center camera
  centerCameraOnFlight(departure, arrival, totalDistance)
  
  // Stop auto-rotation
  setAutoRotate(false)
  autoRotateRef.current = false
}

// Helper: Haversine distance formula
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
```

---

## 5. Testing Strategy

### 5.1 Unit Tests (Manual)

**Test Path Simplification**:
```javascript
// Create test in browser console
const testPoints = [
  {lat: 52.3, lon: 4.7, timestamp: 1000},
  {lat: 52.4, lon: 4.8, timestamp: 1060},
  {lat: 52.5, lon: 4.9, timestamp: 1120},
  // ... 100 more points
]

const simplified = simplifyPath(testPoints, 0.05)
console.log('Reduced from', testPoints.length, 'to', simplified.length, 'points')
```

**Test API Calls**:
```javascript
// Test in browser console after implementation
import { searchFlightByCallsign } from './services/adsbexchange'

searchFlightByCallsign('KL1613')
  .then(data => console.log('Success:', data))
  .catch(err => console.error('Error:', err))
```

### 5.2 Integration Tests

1. **Search for known flight**: KL1613 (KLM Amsterdam → New York)
2. **Verify route display**: Check if waypoints form realistic path
3. **Compare with great circle**: Same airports, toggle between modes
4. **Test edge cases**:
   - Invalid flight number
   - Flight with no track data
   - Very short flight (< 100km)
   - Intercontinental flight (> 10,000km)

### 5.3 Performance Tests

- **Track point count**: Should be reduced from 1000+ to < 150
- **Rendering time**: Should be same as great circle mode
- **Memory usage**: No memory leaks from API calls

### 5.4 Test Flights Database

```javascript
// Good test cases spanning different scenarios
const TEST_FLIGHTS = {
  shortHaul: 'BA1234',    // London → Paris (short, dense track)
  mediumHaul: 'KL1613',   // Amsterdam → New York (transatlantic)
  longHaul: 'SQ25',       // Singapore → New York (polar route)
  domestic: 'AA100',      // US domestic
  polar: 'FI456',         // Nordic Airlines (high latitude)
}
```

---

## 6. Error Handling

### 6.1 API Errors

```javascript
// Graceful degradation
try {
  const results = await searchFlightByCallsign(flightNumber)
} catch (error) {
  if (error.message.includes('404')) {
    setSearchError('Flight not found. Try a different flight number.')
  } else if (error.message.includes('429')) {
    setSearchError('Rate limit exceeded. Please try again in a moment.')
  } else if (error.message.includes('API key')) {
    setSearchError('API configuration error. Please contact support.')
  } else {
    setSearchError('Unable to fetch flight data. Please try again.')
  }
}
```

### 6.2 Data Validation

```javascript
// Validate waypoints before rendering
function validateWaypoints(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('Invalid waypoints: must have at least 2 points')
  }
  
  for (const wp of waypoints) {
    if (typeof wp.lat !== 'number' || typeof wp.lon !== 'number') {
      throw new Error('Invalid waypoint: missing lat/lon')
    }
    
    if (Math.abs(wp.lat) > 90 || Math.abs(wp.lon) > 180) {
      throw new Error('Invalid waypoint: coordinates out of range')
    }
  }
  
  return true
}
```

### 6.3 User Feedback

- **Loading states**: Show spinner during API calls
- **Error messages**: Clear, actionable error text
- **Empty states**: Guide user on what to do
- **Success states**: Confirm flight found before tracking

---

## 7. Performance Optimization

### 7.1 Path Simplification Tuning

```javascript
// Epsilon values for different scenarios
const EPSILON_VALUES = {
  shortHaul: 0.02,   // < 1000km: preserve more detail
  mediumHaul: 0.05,  // 1000-5000km: balanced
  longHaul: 0.1      // > 5000km: aggressive simplification
}

// Adaptive epsilon based on flight distance
function getOptimalEpsilon(distance) {
  if (distance < 1000) return EPSILON_VALUES.shortHaul
  if (distance < 5000) return EPSILON_VALUES.mediumHaul
  return EPSILON_VALUES.longHaul
}
```

### 7.2 Caching Strategy

```javascript
// Cache recent flight searches (optional enhancement)
const flightCache = new Map() // flight number → track data

async function getCachedFlightTrack(icao24) {
  if (flightCache.has(icao24)) {
    console.log('Using cached track data')
    return flightCache.get(icao24)
  }
  
  const track = await getFlightTrack(icao24)
  flightCache.set(icao24, track)
  
  // Limit cache size
  if (flightCache.size > 10) {
    const firstKey = flightCache.keys().next().value
    flightCache.delete(firstKey)
  }
  
  return track
}
```

### 7.3 Debouncing Flight Search

```javascript
// Prevent rapid API calls while user types
let searchTimeout = null

const handleFlightNumberChange = (value) => {
  setFlightNumber(value)
  
  if (searchTimeout) clearTimeout(searchTimeout)
  
  searchTimeout = setTimeout(() => {
    if (value.length >= 3) {
      handleSearchFlight()
    }
  }, 800) // Wait 800ms after user stops typing
}
```

---

## 8. Future Enhancements (Post-v0.6.0)

### Phase 2 Features (v0.7.0)
- **Airport code lookup table**: Full ICAO → IATA mapping
- **Multiple flight results**: Show list if callsign returns multiple flights
- **Date range selector**: Search flights from specific date
- **Flight details panel**: Show altitude profile, speed, aircraft info

### Phase 3 Features (v0.8.0)
- **Comparison mode**: Side-by-side great circle vs actual route
- **Path statistics**: Show deviation from great circle, fuel efficiency
- **Weather overlay**: Show storms/winds that caused route deviations
- **ATC sectors**: Visualize airspace boundaries crossed

### Phase 4 Features (v1.0.0)
- **Real-time tracking**: Live position updates for in-flight aircraft
- **Historical playback**: Scrub through entire flight history
- **Multi-flight view**: Compare routes between different flights
- **Export feature**: Download flight data as KML/GeoJSON

---

## 9. Dependencies & Setup

### 9.1 Required API Access

1. **Sign up for RapidAPI**: https://rapidapi.com/
2. **Subscribe to ADSBexchange API**: Free tier limits TBD
3. **Copy API key** to `.env.local`:
   ```
   VITE_RAPIDAPI_KEY=your_key_here_abc123
   ```

### 9.2 Development Environment

```bash
# No new npm packages needed!
# Everything uses native fetch API and Three.js (already installed)

# Just add environment variable
echo "VITE_RAPIDAPI_KEY=your_key" >> .env.local

# Restart dev server to load env var
npm run dev
```

### 9.3 Git Configuration

```bash
# Make sure .env.local is in .gitignore
echo ".env.local" >> .gitignore

# Commit implementation
git add .
git commit -m "v0.6.0: Add actual flight path tracking via ADSBexchange API"
git tag v0.6.0
git push && git push --tags
```

---

## 10. Documentation Updates

### 10.1 README.md Updates

Add to features section:
```markdown
## Features

- **Dual Route Modes**
  - Great Circle: Theoretical shortest path between airports
  - Actual Flight Path: Real routes flown by specific flights
  
- **Flight Search**
  - Search by flight number (e.g., KL1613)
  - View most recent flight track
  - Compare planned vs actual routes
```

### 10.2 about.md Updates

```markdown
## How It Works

Lightpath uses astronomical calculations to determine the position of the 
Earth's day/night terminator in real-time. When you search for a flight, 
you can choose between:

- **Great Circle Route**: A perfect geodesic line between airports
- **Actual Flight Path**: Real waypoints from the most recent flight with 
  that flight number, retrieved via ADSBexchange API

The app then samples points along the route and calculates the sun elevation 
angle at each point, coloring the path accordingly...
```

### 10.3 data.md Updates

```markdown
## Data Sources

- Airport data: OpenFlights
- Cloud imagery: NOAA GOES-16
- Timezone data: tz-lookup
- **Flight tracking: ADSBexchange via RapidAPI** (NEW)

## APIs

- ADSBexchange API for historical flight track data
- Uses Douglas-Peucker algorithm for path simplification
```

---

## 11. Success Metrics

### 11.1 Technical Metrics

- [ ] API success rate > 95%
- [ ] Average response time < 3 seconds
- [ ] Path simplification reduces points by 80-95%
- [ ] No rendering performance degradation vs great circle

### 11.2 User Experience Metrics

- [ ] Flight search intuitive (< 10 seconds to complete)
- [ ] Error messages clear and actionable
- [ ] Mode switching seamless
- [ ] Results visually distinct from great circle

### 11.3 Code Quality Metrics

- [ ] API service fully abstracted (can swap providers)
- [ ] Path simplification reusable for other features
- [ ] No duplicate code between route modes
- [ ] Comprehensive error handling

---

## 12. Rollout Plan

### Week 1: Development
- Day 1: API client + path simplification (Phase 1-2)
- Day 2: UI updates (Phase 3)
- Day 3: Core logic integration (Phase 4)

### Week 2: Testing & Refinement
- Day 4: Unit testing, fix bugs
- Day 5: Integration testing with real flights
- Day 6: Performance tuning, epsilon optimization
- Day 7: Documentation, commit, deploy

### Week 3: Monitoring
- Monitor API usage/costs
- Collect user feedback
- Fix any edge cases discovered
- Plan Phase 2 features

---

## 13. Risk Assessment

### High Risk
- **API rate limits**: Mitigation → Cache results, show clear messaging
- **API costs**: Mitigation → Monitor usage, implement free tier alerts
- **Data quality**: Mitigation → Validate all waypoints, graceful fallback

### Medium Risk
- **Performance with dense tracks**: Mitigation → Aggressive simplification
- **Airport code mapping**: Mitigation → Build comprehensive lookup table
- **User confusion**: Mitigation → Clear UI labels, tooltips

### Low Risk
- **Browser compatibility**: Using standard fetch API
- **Three.js integration**: Same rendering pipeline as existing code
- **State management**: Minimal new state, follows existing patterns

---

## 14. Questions to Resolve

### Before Implementation
1. ✅ Confirm RapidAPI free tier limits for ADSBexchange
2. ✅ Test actual API response structure (may differ from docs)
3. ✅ Decide on initial epsilon value for path simplification
4. ⏳ Build ICAO → IATA airport code mapping table

### During Implementation
5. ⏳ How to handle flights without track data?
6. ⏳ Should we show aircraft altitude in the visualization?
7. ⏳ Auto-search on flight number entry or require button click?

### Post-Implementation
8. ⏳ User feedback on epsilon value (too smooth vs too jagged?)
9. ⏳ Monitor API usage patterns for cost optimization
10. ⏳ Feature requests for Phase 2

---

## 15. Contact & Support

**Developer**: Studio Folder  
**GitHub**: https://github.com/StudioFolder/lightpath  
**Questions**: Open GitHub issue with `[api-integration]` tag

---

**Status**: Ready for Review  
**Next Action**: Review plan together, then proceed to implementation  
**Estimated Implementation Time**: 3 days  
**Target Version**: v0.6.0
