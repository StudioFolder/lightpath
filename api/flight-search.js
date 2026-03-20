const FR24_BASE = 'https://fr24api.flightradar24.com/api';

function isoUtc(date) {
  return date.toISOString().slice(0, 19);
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

  const now  = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 14);

  const params = new URLSearchParams({
    flights:              flight,
    flight_datetime_from: isoUtc(from),
    flight_datetime_to:   isoUtc(now),
    sort:                 'desc',
    limit:                '2',
  });

  let fr24Res;
  try {
    fr24Res = await fetch(`${FR24_BASE}/flight-summary/light?${params}`, {
      headers: {
        Authorization:    `Bearer ${process.env.FR24_API_TOKEN}`,
        'Accept-Version': 'v1',
        Accept:           'application/json',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach FR24 API', detail: err.message });
  }

  const body = await fr24Res.text();
  res.status(fr24Res.status);
  res.setHeader('Content-Type', 'application/json');

  if (fr24Res.status !== 200) {
    return res.end(body);
  }

  const json = JSON.parse(body);
  const completed = (json.data ?? []).find(f => f.flight_ended === true);
  return res.end(JSON.stringify(completed ? { data: [completed] } : json));
};
