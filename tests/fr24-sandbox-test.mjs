import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Config ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');

const envContent = fs.readFileSync(envPath, 'utf8');
const tokenMatch = envContent.match(/^FR24_API_TOKEN=(.+)$/m);
if (!tokenMatch) throw new Error('.env.local must contain FR24_API_TOKEN=...');
const TOKEN = tokenMatch[1].trim();

const BASE = 'https://fr24api.flightradar24.com/api';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Accept-Version': 'v1',
  Accept: 'application/json',
};

// --- Helpers ---
function isoDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function now() { return new Date(); }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function apiFetch(label, url) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`REQUEST: ${label}`);
  console.log(`URL:     ${url}`);

  const res = await fetch(url, { headers: HEADERS });

  // Credit cost headers
  const creditHeaders = {};
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase().includes('credit') || k.toLowerCase().includes('x-ratelimit')) {
      creditHeaders[k] = v;
    }
  }

  let body;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }

  console.log(`STATUS:  ${res.status} ${res.statusText}`);

  if (Object.keys(creditHeaders).length > 0) {
    console.log('CREDITS:', creditHeaders);
  } else {
    console.log('CREDITS: (no credit/rate-limit headers returned)');
  }

  console.log('\nRESPONSE JSON:');
  console.log(JSON.stringify(body, null, 2));

  return { status: res.status, body };
}

function summariseSummary(body) {
  const items = body?.data ?? (Array.isArray(body) ? body : []);
  console.log(`\nSUMMARY: ${items.length} result(s)`);
  for (const item of items) {
    console.log(`  fr24_id=${item.fr24_id}  flight=${item.flight}  orig=${item.orig_iata ?? item.orig_icao}→${item.dest_iata ?? item.dest_icao}  dep=${item.actual_off_utc ?? item.scheduled_off_utc}`);
  }
  return items[0]?.fr24_id ?? null;
}

function summariseEvents(body) {
  // Response is wrapped: body.data[0].events
  const records = body?.data ?? (Array.isArray(body) ? body : []);
  const events = records[0]?.events ?? records;

  const withLatLon    = events.filter(e => e.lat != null && e.lon != null);
  const withoutLatLon = events.filter(e => e.lat == null || e.lon  == null);
  const types = [...new Set(events.map(e => e.type ?? e.event_type).filter(Boolean))];

  console.log(`\nANALYSIS:`);
  console.log(`  Total events : ${events.length}`);
  console.log(`  With lat/lon : ${withLatLon.length}`);
  console.log(`  Without      : ${withoutLatLon.length}`);
  console.log(`  Event types  : ${types.length ? types.join(', ') : '(none detected)'}`);

  if (events.length > 0) {
    console.log('\n  Per-event breakdown:');
    for (const e of events) {
      const hasPos = e.lat != null && e.lon != null;
      const pos    = hasPos ? `lat=${e.lat} lon=${e.lon}` : 'lat=— lon=—';
      const alt    = e.alt  != null ? ` alt=${e.alt}`  : '';
      const type   = e.type ?? e.event_type ?? '(unknown)';
      console.log(`    [${hasPos ? '✓' : '✗'}] type=${type.padEnd(30)} ${pos}${alt}`);
    }
  }

  if (events.length > 0 && withLatLon.length === 0) {
    console.log('\n  ⚠  No events have lat/lon — may not be useful for airspace transitions');
  }
}

// --- Tests ---
async function testFlight(flightNumber, label) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`FLIGHT TEST: ${flightNumber} — ${label}`);
  console.log(`${'═'.repeat(60)}`);

  // Step 1: Flight Summary Light
  const from = isoDate(daysAgo(14));
  const to   = isoDate(now());
  const summaryUrl = `${BASE}/flight-summary/light?flights=${flightNumber}&flight_datetime_from=${from}&flight_datetime_to=${to}&sort=desc&limit=1`;

  const { status: s1, body: b1 } = await apiFetch('Flight Summary Light', summaryUrl);
  if (s1 !== 200) {
    console.log(`\n⛔ Skipping events — summary request failed (${s1})`);
    return;
  }

  const fr24Id = summariseSummary(b1);
  if (!fr24Id) {
    console.log('\n⚠  No fr24_id found — cannot fetch events');
    return;
  }

  // Step 2a: Historic Flight Events Full
  const eventsFullUrl  = `${BASE}/historic/flight-events/full?flight_ids=${fr24Id}&event_types=all`;
  const { status: s2, body: b2 } = await apiFetch('Historic Flight Events Full', eventsFullUrl);
  if (s2 === 200) summariseEvents(b2);
  else console.log(`\n⛔ Events (full) request failed (${s2})`);

  // Step 2b: Historic Flight Events Light
  const eventsLightUrl = `${BASE}/historic/flight-events/light?flight_ids=${fr24Id}&event_types=all`;
  const { status: s3, body: b3 } = await apiFetch('Historic Flight Events Light', eventsLightUrl);
  if (s3 === 200) summariseEvents(b3);
  else console.log(`\n⛔ Events (light) request failed (${s3})`);
}

// --- Main ---
console.log('FR24 Sandbox API Test');
console.log(`Token: ${TOKEN.slice(0, 12)}...`);
console.log(`Base:  ${BASE}`);

await testFlight('KL1613', 'Amsterdam–London, ~1h');
await testFlight('KL1009', 'Amsterdam–Milan, ~1.5h');

console.log(`\n${'═'.repeat(60)}`);
console.log('Done.');
