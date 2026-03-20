export function buildControlPoints(events, departureAirport, arrivalAirport) {
  const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const firstEvent = sorted[0];
  const lastEvent  = sorted[sorted.length - 1];

  const middle = sorted.filter(e => e.lat != null && e.lon != null);

  return [
    { lat: departureAirport.lat, lon: departureAirport.lon, timestamp: firstEvent?.timestamp ?? null },
    ...middle.map(e => ({ lat: e.lat, lon: e.lon, timestamp: e.timestamp })),
    { lat: arrivalAirport.lat,   lon: arrivalAirport.lon,  timestamp: lastEvent?.timestamp  ?? null },
  ];
}

/**
 * Interpolate a timestamp at a given arc-length fraction along the route.
 *
 * @param {Array}  controlPoints      - Array of { lat, lon, timestamp }
 * @param {number} fraction           - Arc-length fraction 0–1
 * @param {Array}  [arcLengthFractions] - Per-control-point arc-length fractions.
 *   If omitted, falls back to linear interpolation between first and last timestamps.
 */
export function interpolateTimestamp(controlPoints, fraction, arcLengthFractions) {
  if (!arcLengthFractions) {
    const t0 = new Date(controlPoints[0].timestamp).getTime();
    const t1 = new Date(controlPoints[controlPoints.length - 1].timestamp).getTime();
    return new Date(t0 + fraction * (t1 - t0));
  }

  // Find the segment [i, i+1] that contains this arc-length fraction
  let i = arcLengthFractions.length - 2;
  for (let j = 0; j < arcLengthFractions.length - 1; j++) {
    if (fraction <= arcLengthFractions[j + 1]) {
      i = j;
      break;
    }
  }

  const segSpan = arcLengthFractions[i + 1] - arcLengthFractions[i];
  const t = segSpan === 0 ? 0 : (fraction - arcLengthFractions[i]) / segSpan;

  const ms0 = new Date(controlPoints[i].timestamp).getTime();
  const ms1 = new Date(controlPoints[i + 1].timestamp).getTime();
  return new Date(ms0 + t * (ms1 - ms0));
}
