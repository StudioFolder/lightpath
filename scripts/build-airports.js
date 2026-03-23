import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.resolve(__dirname, "../data/data-sources/world-airports.csv");
const DEST = path.resolve(__dirname, "../public/airports.json");

const VALID_TYPES = new Set(["large_airport", "medium_airport", "small_airport"]);
const SHORT_TYPE = {
  large_airport: "large",
  medium_airport: "medium",
  small_airport: "small",
};

// Parse a CSV line, respecting quoted fields that may contain commas
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(SRC),
    crlfDelay: Infinity,
  });

  let headers = null;
  const airports = [];
  const typeCounts = { large: 0, medium: 0, small: 0 };

  for await (const line of rl) {
    if (!headers) {
      headers = parseCSVLine(line);
      continue;
    }

    const fields = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = fields[i] || ""));

    if (!VALID_TYPES.has(row.type)) continue;
    if (!row.iata_code) continue;
    if (!row.municipality) continue;

    typeCounts[SHORT_TYPE[row.type]]++;

    airports.push({
      iata: row.iata_code,
      icao: row.icao_code,
      name: row.name,
      municipality: row.municipality,
      country: row.country_name,
      iso: row.iso_country,
      lat: parseFloat(row.latitude_deg),
      lon: parseFloat(row.longitude_deg),
      type: SHORT_TYPE[row.type],
      score: parseInt(row.score, 10) || 0,
    });
  }

  fs.writeFileSync(DEST, JSON.stringify(airports));

  const total = airports.length;
  console.log(`Wrote ${total} airports to ${path.relative(process.cwd(), DEST)}`);
  console.log(`  large:  ${typeCounts.large}`);
  console.log(`  medium: ${typeCounts.medium}`);
  console.log(`  small:  ${typeCounts.small}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
