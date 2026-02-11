/**
 * OpenSky Network API Client
 * 
 * Provides access to historical flight tracking data via OpenSky Network.
 * 
 * Documentation: https://openskynetwork.github.io/opensky-api/rest.html
 */

// Store credentials
const CLIENT_ID = import.meta.env.VITE_OPENSKY_CLIENT_ID
const CLIENT_SECRET = import.meta.env.VITE_OPENSKY_CLIENT_SECRET

// Token management
let cachedToken = null
let tokenExpiry = null

/**
 * Get OAuth2 access token for API authentication
 * Tokens expire after 30 minutes, so we cache and refresh as needed
 */
async function getAccessToken() {
  // Return cached token if still valid (with 5min buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
    return cachedToken
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('OpenSky credentials not configured. Please add VITE_OPENSKY_CLIENT_ID and VITE_OPENSKY_CLIENT_SECRET to .env.local')
  }

  console.log('Fetching new OpenSky access token...')

  try {
    const response = await fetch(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`)
    }

    const data = await response.json()
    
    cachedToken = data.access_token
    tokenExpiry = Date.now() + (data.expires_in * 1000) // Convert seconds to ms
    
    console.log('✅ Token obtained, expires in', data.expires_in, 'seconds')
    
    return cachedToken
  } catch (error) {
    throw new Error(`Authentication failed: ${error.message}`)
  }
}

/**
 * Get flights for a specific aircraft within a time range
 * 
 * @param {string} icao24 - ICAO 24-bit aircraft identifier (hex, lowercase, e.g. "a8cffd")
 * @param {number} begin - Start time (Unix timestamp in seconds)
 * @param {number} end - End time (Unix timestamp in seconds)
 * @returns {Promise<Array>} Array of flight objects
 */
export async function getFlightsByAircraft(icao24, begin, end) {
  const token = await getAccessToken()
  
  // Ensure icao24 is lowercase
  const cleanIcao = icao24.toLowerCase()
  
  // Time range must not exceed 2 days (API limitation)
  const timeDiff = end - begin
  if (timeDiff > 172800) {
    throw new Error('Time range cannot exceed 2 days (172800 seconds)')
  }

  console.log('Fetching flights for aircraft:', cleanIcao, 'from', new Date(begin * 1000).toISOString(), 'to', new Date(end * 1000).toISOString())

  try {
    const response = await fetch(
      `https://opensky-network.org/api/flights/aircraft?icao24=${cleanIcao}&begin=${begin}&end=${end}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('No flights found for this aircraft in the given time period')
      } else if (response.status === 401) {
        // Token expired, clear cache and retry once
        cachedToken = null
        tokenExpiry = null
        throw new Error('Authentication expired, please try again')
      } else {
        throw new Error(`API error: ${response.status}`)
      }
    }

    const flights = await response.json()
    
    console.log('✅ Found', flights.length, 'flights')
    
    return flights
  } catch (error) {
    if (error.message.includes('Authentication expired')) {
      throw error // Let caller retry
    }
    throw new Error(`Failed to fetch flights: ${error.message}`)
  }
}

/**
 * Get the track (waypoints) for a specific flight
 * 
 * @param {string} icao24 - ICAO 24-bit aircraft identifier (hex, lowercase)
 * @param {number} time - Any Unix timestamp within the flight period
 * @returns {Promise<Object>} Track object with waypoints
 */
export async function getFlightTrack(icao24, time) {
  const token = await getAccessToken()
  
  const cleanIcao = icao24.toLowerCase()
  
  console.log('Fetching track for aircraft:', cleanIcao, 'at time:', new Date(time * 1000).toISOString())

  try {
    const response = await fetch(
      `https://opensky-network.org/api/tracks/all?icao24=${cleanIcao}&time=${time}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('No track data found for this flight')
      } else if (response.status === 401) {
        cachedToken = null
        tokenExpiry = null
        throw new Error('Authentication expired, please try again')
      } else {
        throw new Error(`API error: ${response.status}`)
      }
    }

    const track = await response.json()
    
    console.log('✅ Track received:', track.path ? track.path.length : 0, 'waypoints')
    
    // Validate track structure
    if (!track.path || !Array.isArray(track.path) || track.path.length === 0) {
      throw new Error('Track data is empty or invalid')
    }
    
    return track
  } catch (error) {
    if (error.message.includes('Authentication expired')) {
      throw error
    }
    throw new Error(`Failed to fetch track: ${error.message}`)
  }
}

/**
 * Search for flights by callsign (flight number)
 * Note: OpenSky doesn't have a direct callsign search, so we need to:
 * 1. Get recent flights from major airports
 * 2. Filter by callsign
 * 
 * This is a workaround - for production, you'd want a callsign->icao24 lookup table
 * 
 * @param {string} callsign - Flight callsign (e.g. "UAL123")
 * @returns {Promise<Array>} Flights matching the callsign
 */
export async function searchFlightByCallsign(callsign) {
  // For now, we'll implement a simpler approach:
  // Return instruction to user that they need to provide ICAO24 or airport codes
  // In the future, we can build a callsign lookup cache
  
  throw new Error('Direct callsign search not supported by OpenSky API. Please use airport departure/arrival search instead.')
}

/**
 * Get flights departing from an airport in a time range
 * 
 * @param {string} airport - ICAO airport code (e.g., "KJFK")
 * @param {number} begin - Start time (Unix timestamp in seconds)
 * @param {number} end - End time (Unix timestamp in seconds)
 * @param {boolean} anonymous - Use anonymous access (no auth token)
 * @returns {Promise<Array>} Array of departing flights
 */
export async function getDeparturesByAirport(airport, begin, end, anonymous = false) {
  const airportCode = airport.toUpperCase()
  
  // Time range must not exceed 2 days
  const timeDiff = end - begin
  if (timeDiff > 172800) {
    throw new Error('Time range cannot exceed 2 days')
  }

  console.log('Fetching departures from', airportCode, anonymous ? '(anonymous)' : '(authenticated)')

  try {
    const headers = {}
    
    // Only add auth if not anonymous
    if (!anonymous) {
      const token = await getAccessToken()
      headers['Authorization'] = `Bearer ${token}`
    }
    
    const response = await fetch(
      `https://opensky-network.org/api/flights/departure?airport=${airportCode}&begin=${begin}&end=${end}`,
      {
        method: 'GET',
        headers
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return [] // No flights found
      }
      throw new Error(`API error: ${response.status}`)
    }

    const flights = await response.json()
    console.log('✅ Found', flights.length, 'departures')
    
    return flights
  } catch (error) {
    throw new Error(`Failed to fetch departures: ${error.message}`)
  }
}

/**
 * Get flights arriving at an airport in a time range
 * 
 * @param {string} airport - ICAO airport code (e.g., "KJFK")
 * @param {number} begin - Start time (Unix timestamp in seconds)
 * @param {number} end - End time (Unix timestamp in seconds)
 * @returns {Promise<Array>} Array of arriving flights
 */
export async function getArrivalsByAirport(airport, begin, end) {
  const token = await getAccessToken()
  
  const airportCode = airport.toUpperCase()
  
  const timeDiff = end - begin
  if (timeDiff > 172800) {
    throw new Error('Time range cannot exceed 2 days')
  }

  console.log('Fetching arrivals to', airportCode)

  try {
    const response = await fetch(
      `https://opensky-network.org/api/flights/arrival?airport=${airportCode}&begin=${begin}&end=${end}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return []
      }
      throw new Error(`API error: ${response.status}`)
    }

    const flights = await response.json()
    console.log('✅ Found', flights.length, 'arrivals')
    
    return flights
  } catch (error) {
    throw new Error(`Failed to fetch arrivals: ${error.message}`)
  }
}

/**
 * Helper: Convert waypoint array to standardized format
 * OpenSky waypoints are arrays: [time, lat, lon, baro_alt, true_track, on_ground]
 * 
 * @param {Array} path - Raw path array from OpenSky
 * @returns {Array} Standardized waypoint objects
 */
export function parseWaypoints(path) {
  return path.map(point => ({
    timestamp: point[0],      // Unix timestamp in seconds
    lat: point[1],            // Latitude in degrees
    lon: point[2],            // Longitude in degrees
    altitude: point[3],       // Barometric altitude in meters
    heading: point[4],        // True track in degrees
    onGround: point[5]        // Boolean
  }))
}

/**
 * Parse ICAO airport code to IATA code
 * Same mapping as before - extend as needed
 */
export function parseAirportCode(icaoCode) {
  if (!icaoCode || icaoCode.length !== 4) {
    return icaoCode
  }

  const icaoToIata = {
    // Europe
    'EHAM': 'AMS', 'EGLL': 'LHR', 'LFPG': 'CDG', 'EDDF': 'FRA',
    'LEMD': 'MAD', 'LIRF': 'FCO', 'LSZH': 'ZRH', 'LOWW': 'VIE',
    'EDDM': 'MUC', 'LEBL': 'BCN',
    
    // North America
    'KJFK': 'JFK', 'KLAX': 'LAX', 'KORD': 'ORD', 'KATL': 'ATL',
    'KDFW': 'DFW', 'KSFO': 'SFO', 'KBOS': 'BOS', 'KMIA': 'MIA',
    'CYYZ': 'YYZ',
    
    // Asia
    'RJTT': 'HND', 'RJBB': 'KIX', 'VHHH': 'HKG', 'WSSS': 'SIN',
    'ZSPD': 'PVG', 'ZBAA': 'PEK', 'RKSI': 'ICN',
    
    // Middle East
    'OMDB': 'DXB', 'OTHH': 'DOH',
    
    // Oceania
    'YSSY': 'SYD', 'YMML': 'MEL', 'NZAA': 'AKL',
  }
  
  return icaoToIata[icaoCode] || icaoCode
}