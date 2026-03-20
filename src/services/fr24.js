export async function searchFlight(flightNumber) {
  const res = await fetch(`/api/flight-search?flight=${encodeURIComponent(flightNumber)}`);
  if (!res.ok) throw new Error(`flight-search failed: ${res.status}`);
  const json = await res.json();
  return json.data?.[0] ?? null;
}

export async function getFlightEvents(fr24Id) {
  const res = await fetch(`/api/flight-events?fr24_id=${encodeURIComponent(fr24Id)}`);
  if (!res.ok) throw new Error(`flight-events failed: ${res.status}`);
  const json = await res.json();
  return json.data?.[0] ?? null;
}
