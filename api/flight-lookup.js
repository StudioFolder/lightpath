import { Redis } from '@upstash/redis';

const FR24_BASE = 'https://fr24api.flightradar24.com/api';

// Matches what FlightInputPanel can emit: a 2-char IATA code (may contain one
// digit, e.g. 9G, A3) or a 3-letter ICAO code, then 1–4 digits and an optional
// suffix letter.
const FLIGHT_RE = /^(?:[A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})\d{1,4}[A-Z]?$/;

const FOUND_TTL_S     = 30 * 24 * 60 * 60; // 30 days
const NOT_FOUND_TTL_S = 6 * 60 * 60;       // 6 hours

const IP_LIMIT_PER_HOUR = 20;
const IP_WINDOW_S       = 60 * 60;
const FR24_DAILY_CAP    = Number.parseInt(process.env.FR24_DAILY_CAP, 10) || 200;
const DAY_WINDOW_S      = 24 * 60 * 60;

const redis = process.env.KV_REST_API_URL
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    })
  : null;

const FR24_HEADERS = {
  Authorization:    `Bearer ${process.env.FR24_API_TOKEN}`,
  'Accept-Version': 'v1',
  Accept:           'application/json',
};

function isoUtc(date) {
  return date.toISOString().slice(0, 19);
}

function toMs(ts) {
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  return new Date(ts).getTime();
}

function normaliseFlight(raw) {
  if (typeof raw !== 'string') return null;
  const flight = raw.replace(/\s+/g, '').toUpperCase();
  return FLIGHT_RE.test(flight) ? flight : null;
}

function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

// INCR a windowed counter and set its TTL on first hit. Returns the new count.
async function bump(key, windowS) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowS);
  return count;
}

// Returns true when the caller may hit FR24. Only called for uncached lookups.
// If Redis is unavailable the limits are skipped rather than failing the lookup.
async function allowUncachedLookup(ip) {
  if (!redis) return true;
  try {
    const nowS = Math.floor(Date.now() / 1000);
    const ipKey = `rl:ip:${ip}:${Math.floor(nowS / IP_WINDOW_S)}`;
    if ((await bump(ipKey, IP_WINDOW_S)) > IP_LIMIT_PER_HOUR) return false;

    const dayKey = `rl:fr24:${new Date().toISOString().slice(0, 10)}`;
    if ((await bump(dayKey, DAY_WINDOW_S)) > FR24_DAILY_CAP) return false;

    return true;
  } catch {
    return true;
  }
}

async function cacheSet(key, value, ttlS) {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlS });
  } catch {
    // Cache write failed — non-critical
  }
}

export default async function handler(req, res) {
  const flight = normaliseFlight(req.query?.flight);
  if (!flight) {
    return res.status(400).json({ error: 'invalid_flight' });
  }

  const key = `flight:${flight}`;

  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const data = cached.notFound ? null : cached;
        return res.status(200).json({ data, cached: true });
      }
    } catch {
      // Cache read failed — fall through to FR24
    }
  }

  if (!(await allowUncachedLookup(clientIp(req)))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  // Step 1: Flight Summary Light
  const now  = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 14);

  const summaryParams = new URLSearchParams({
    flights:              flight,
    flight_datetime_from: isoUtc(from),
    flight_datetime_to:   isoUtc(now),
    sort:                 'desc',
    limit:                '2',
  });

  let summaryRes;
  try {
    summaryRes = await fetch(`${FR24_BASE}/flight-summary/light?${summaryParams}`, {
      headers: FR24_HEADERS,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach FR24 API', detail: err.message });
  }

  if (summaryRes.status === 429 || summaryRes.status === 403) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  if (summaryRes.status !== 200) {
    return res.status(summaryRes.status).json({ error: 'request_failed' });
  }

  const summaryJson = await summaryRes.json();
  const completed = (summaryJson.data ?? []).find(f => f.flight_ended === true);

  if (!completed) {
    await cacheSet(key, { notFound: true }, NOT_FOUND_TTL_S);
    return res.status(200).json({ data: null, cached: false });
  }

  // Step 2: Historic Flight Events Light
  const eventsParams = new URLSearchParams({
    flight_ids:  completed.fr24_id,
    event_types: 'all',
  });

  let eventsRes;
  try {
    eventsRes = await fetch(`${FR24_BASE}/historic/flight-events/light?${eventsParams}`, {
      headers: FR24_HEADERS,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach FR24 API', detail: err.message });
  }

  if (eventsRes.status === 429 || eventsRes.status === 403) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  if (eventsRes.status !== 200) {
    return res.status(eventsRes.status).json({ error: 'request_failed' });
  }

  const eventsJson = await eventsRes.json();
  const record = eventsJson.data?.[0];
  const rawEvents = record?.events ?? [];

  // Compute offsetMs relative to first event's timestamp
  const firstTs = rawEvents.length > 0 ? toMs(rawEvents[0].timestamp) : 0;
  const events = rawEvents.map(ev => ({
    type:     ev.type,
    lat:      ev.lat ?? null,
    lon:      ev.lon ?? null,
    offsetMs: toMs(ev.timestamp) - firstTs,
    details:  ev.details ?? {},
  }));

  const totalDurationMs = events.length > 0 ? events[events.length - 1].offsetMs : 0;

  // Extract typical departure time as "HH:MM" from datetime_takeoff (UTC)
  let typicalDepartureTimeUtc = null;
  if (completed.datetime_takeoff) {
    const takeoff = new Date(toMs(completed.datetime_takeoff));
    const hh = String(takeoff.getUTCHours()).padStart(2, '0');
    const mm = String(takeoff.getUTCMinutes()).padStart(2, '0');
    typicalDepartureTimeUtc = `${hh}:${mm}`;
  }

  const payload = {
    summary: {
      flight:           completed.flight,
      orig_icao:        completed.orig_icao,
      dest_icao:        completed.dest_icao,
      dest_icao_actual: completed.dest_icao_actual,
      type:             completed.type,
      reg:              completed.reg,
      callsign:         completed.callsign,
    },
    events,
    totalDurationMs,
    typicalDepartureTimeUtc,
  };

  await cacheSet(key, payload, FOUND_TTL_S);

  return res.status(200).json({ data: payload, cached: false });
}
