const FR24_BASE = 'https://fr24api.flightradar24.com/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const { fr24_id } = req.query;
  if (!fr24_id) {
    return res.status(400).json({ error: 'Missing required query parameter: fr24_id' });
  }

  const params = new URLSearchParams({
    flight_ids:  fr24_id,
    event_types: 'all',
  });

  let fr24Res;
  try {
    fr24Res = await fetch(`${FR24_BASE}/historic/flight-events/light?${params}`, {
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
  return res.end(body);
};
