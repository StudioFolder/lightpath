const flightCache = new Map();

export async function lookupFlight(flightNumber) {
  const key = flightNumber.trim().toUpperCase();

  // Check in-memory session cache
  const cached = flightCache.get(key);
  if (cached) return cached;

  const res = await fetch(`/api/flight-lookup?flight=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`flight-lookup failed: ${res.status}`);
  const json = await res.json();
  const data = json.data ?? null;

  // Cache the result (even null, to avoid repeated lookups for nonexistent flights)
  if (data) flightCache.set(key, data);

  return data;
}
