const FR24_BASE = 'https://fr24api.flightradar24.com/api';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const { flight } = req.query;
  if (!flight) {
    return res.status(400).json({ error: 'Missing required query parameter: flight' });
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

  if (summaryRes.status !== 200) {
    const body = await summaryRes.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(summaryRes.status).end(body);
  }

  const summaryJson = await summaryRes.json();
  const completed = (summaryJson.data ?? []).find(f => f.flight_ended === true);

  if (!completed) {
    return res.status(200).json({ data: null });
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

  if (eventsRes.status !== 200) {
    const body = await eventsRes.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(eventsRes.status).end(body);
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

  return res.status(200).json({
    data: {
      summary: {
        flight:          completed.flight,
        orig_icao:       completed.orig_icao,
        dest_icao:       completed.dest_icao,
        dest_icao_actual: completed.dest_icao_actual,
        type:            completed.type,
        reg:             completed.reg,
        callsign:        completed.callsign,
      },
      events,
      totalDurationMs,
      typicalDepartureTimeUtc,
    },
  });
}
