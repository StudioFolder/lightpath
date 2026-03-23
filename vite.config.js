import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      {
        name: 'flight-lookup-proxy',
        configureServer(server) {
          server.middlewares.use('/api/flight-lookup', async (req, res) => {
            const url = new URL(req.url, 'http://localhost');
            const flight = url.searchParams.get('flight');
            if (!flight) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing flight param' }));
              return;
            }

            const FR24 = 'https://fr24api.flightradar24.com/api';
            const headers = {
              Authorization: `Bearer ${env.FR24_API_TOKEN}`,
              'Accept-Version': 'v1',
              Accept: 'application/json',
            };

            const now = new Date();
            const from = new Date(now);
            from.setDate(from.getDate() - 14);
            const isoUtc = (d) => d.toISOString().slice(0, 19);

            // Step 1: Summary
            const summaryParams = new URLSearchParams({
              flights: flight,
              flight_datetime_from: isoUtc(from),
              flight_datetime_to: isoUtc(now),
              sort: 'desc',
              limit: '2',
            });

            let summaryRes;
            try {
              summaryRes = await fetch(`${FR24}/flight-summary/light?${summaryParams}`, { headers });
            } catch (err) {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'FR24 unreachable', detail: err.message }));
              return;
            }

            if (summaryRes.status !== 200) {
              res.statusCode = summaryRes.status;
              res.end(await summaryRes.text());
              return;
            }

            const summaryJson = await summaryRes.json();
            const completed = (summaryJson.data ?? []).find(f => f.flight_ended === true);
            if (!completed) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ data: null }));
              return;
            }

            // Step 2: Events
            const eventsParams = new URLSearchParams({
              flight_ids: completed.fr24_id,
              event_types: 'all',
            });

            let eventsRes;
            try {
              eventsRes = await fetch(`${FR24}/historic/flight-events/light?${eventsParams}`, { headers });
            } catch (err) {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'FR24 unreachable', detail: err.message }));
              return;
            }

            if (eventsRes.status !== 200) {
              res.statusCode = eventsRes.status;
              res.end(await eventsRes.text());
              return;
            }

            const eventsJson = await eventsRes.json();
            const record = eventsJson.data?.[0];
            const rawEvents = record?.events ?? [];

            function toMs(ts) {
              if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
              return new Date(ts).getTime();
            }

            const firstTs = rawEvents.length > 0 ? toMs(rawEvents[0].timestamp) : 0;
            const events = rawEvents.map(ev => ({
              type: ev.type,
              lat: ev.lat ?? null,
              lon: ev.lon ?? null,
              offsetMs: toMs(ev.timestamp) - firstTs,
              details: ev.details ?? {},
            }));

            const totalDurationMs = events.length > 0 ? events[events.length - 1].offsetMs : 0;

            let typicalDepartureTimeUtc = null;
            if (completed.datetime_takeoff) {
              const takeoff = new Date(toMs(completed.datetime_takeoff));
              const hh = String(takeoff.getUTCHours()).padStart(2, '0');
              const mm = String(takeoff.getUTCMinutes()).padStart(2, '0');
              typicalDepartureTimeUtc = `${hh}:${mm}`;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              data: {
                summary: {
                  flight: completed.flight,
                  orig_icao: completed.orig_icao,
                  dest_icao: completed.dest_icao,
                  dest_icao_actual: completed.dest_icao_actual,
                  type: completed.type,
                  reg: completed.reg,
                  callsign: completed.callsign,
                },
                events,
                totalDurationMs,
                typicalDepartureTimeUtc,
              },
              cached: false,
            }));
          });
        },
      },
    ],
  }
})
