import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
const tokenMatch = envContent.match(/^FR24_API_TOKEN=(.+)$/m);
if (!tokenMatch) throw new Error('.env.local must contain FR24_API_TOKEN=...');
const TOKEN = tokenMatch[1].trim();

const BASE = 'https://fr24api.flightradar24.com/api';
const HEADERS = {
  Authorization:    `Bearer ${TOKEN}`,
  'Accept-Version': 'v1',
  Accept:           'application/json',
};

function isoUtc(date) { return date.toISOString().slice(0, 19); }

async function apiFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function testFlight(flightNumber, label) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`FLIGHT: ${flightNumber}  —  ${label}`);
  console.log('═'.repeat(64));

  // Step 1: Flight Summary Light
  const now  = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 14);
  const params = new URLSearchParams({
    flights:              flightNumber,
    flight_datetime_from: isoUtc(from),
    flight_datetime_to:   isoUtc(now),
    sort:                 'desc',
    limit:                '1',
  });

  console.log(`\n[1] Flight Summary Light`);
  const { status: s1, body: b1 } = await apiFetch(`${BASE}/flight-summary/light?${params}`);
  console.log(`    STATUS: ${s1}`);

  if (s1 !== 200) {
    console.log(`    ERROR: ${JSON.stringify(b1)}`);
    return null;
  }

  const items = b1?.data ?? [];
  if (!items.length) {
    console.log('    No results returned.');
    return null;
  }

  const f = items[0];
  console.log(`    fr24_id   : ${f.fr24_id}`);
  console.log(`    flight    : ${f.flight}  callsign: ${f.callsign}`);
  console.log(`    route     : ${f.orig_icao ?? '?'} → ${f.dest_icao ?? '?'}`);
  console.log(`    takeoff   : ${f.datetime_takeoff ?? '—'}`);
  console.log(`    landed    : ${f.datetime_landed  ?? '—'}`);
  console.log(`    aircraft  : ${f.type ?? '—'}  reg: ${f.reg ?? '—'}`);

  // Step 2: Historic Flight Events Light
  console.log(`\n[2] Historic Flight Events Light  (fr24_id=${f.fr24_id})`);
  const evParams = new URLSearchParams({ flight_ids: f.fr24_id, event_types: 'all' });
  const { status: s2, body: b2 } = await apiFetch(`${BASE}/historic/flight-events/light?${evParams}`);
  console.log(`    STATUS: ${s2}`);

  if (s2 !== 200) {
    console.log(`    ERROR: ${JSON.stringify(b2)}`);
    return { flightNumber, fr24_id: f.fr24_id, eventCount: 0, withPos: 0 };
  }

  const records = b2?.data ?? [];
  const events  = records[0]?.events ?? [];
  const withPos = events.filter(e => e.lat != null && e.lon != null);

  console.log(`    Total events : ${events.length}`);
  console.log(`    With lat/lon : ${withPos.length}`);
  console.log(`    Without      : ${events.length - withPos.length}`);
  console.log('');
  console.log('    #   type                           timestamp             lat/lon');
  console.log('    ' + '─'.repeat(80));
  events.forEach((e, i) => {
    const hasPos = e.lat != null && e.lon != null;
    const pos    = hasPos ? `${e.lat}, ${e.lon}` : '—';
    const type   = (e.type ?? '(unknown)').padEnd(30);
    const ts     = (e.timestamp ?? '—').padEnd(22);
    console.log(`    ${String(i + 1).padStart(2)}  ${type}  ${ts}  ${pos}`);
  });

  return { flightNumber, label, fr24_id: f.fr24_id, eventCount: events.length, withPos: withPos.length };
}

async function checkUsage() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log('USAGE / REMAINING CREDITS');
  console.log('═'.repeat(64));
  const { status, body } = await apiFetch(`${BASE}/usage`);
  console.log(`STATUS: ${status}`);
  console.log(JSON.stringify(body, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────
console.log('FR24 Production API Test');
console.log(`Token: ${TOKEN.slice(0, 12)}...`);

const flights = [
  ['KL605',  'Long-haul transatlantic — AMS→JFK'],
  ['SQ25',   'Ultra long-haul — SIN→JFK'],
  ['KL1009', 'Short-haul European — AMS→LHR'],
];

const results = [];
for (const [num, label] of flights) {
  const r = await testFlight(num, label);
  if (r) results.push(r);
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log('SUMMARY');
console.log('═'.repeat(64));
console.log(`${'Flight'.padEnd(10)}  ${'fr24_id'.padEnd(12)}  ${'Events'.padStart(6)}  ${'w/ lat/lon'.padStart(10)}  Label`);
console.log('─'.repeat(64));
for (const r of results) {
  console.log(`${r.flightNumber.padEnd(10)}  ${r.fr24_id.padEnd(12)}  ${String(r.eventCount).padStart(6)}  ${String(r.withPos).padStart(10)}  ${r.label}`);
}

await checkUsage();

console.log(`\n${'═'.repeat(64)}`);
console.log('Done.');
