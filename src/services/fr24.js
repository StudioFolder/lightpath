const flightCache = new Map();

export async function lookupFlight(flightNumber) {
  const key = flightNumber.replace(/\s+/g, '').toUpperCase();

  // Check in-memory session cache (null is a cached "not found")
  if (flightCache.has(key)) return flightCache.get(key);

  const res = await fetch(`/api/flight-lookup?flight=${encodeURIComponent(key)}`);
  if (!res.ok) {
    // The server rejects malformed flight numbers with 400; surface that as "not found".
    if (res.status === 400) {
      flightCache.set(key, null);
      return null;
    }
    if (res.status === 429) throw new Error('rate_limited');
    if (res.status >= 500) throw new Error('server_error');
    throw new Error('request_failed');
  }
  const json = await res.json();
  const data = json.data ?? null;

  // Cache the result (even null, to avoid repeated lookups for nonexistent flights)
  flightCache.set(key, data);

  return data;
}
