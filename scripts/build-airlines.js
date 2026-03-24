/**
 * Converts iata-utils airlines CSV into a compact JSON file for autocomplete.
 * Source: https://github.com/benct/iata-utils/blob/master/generated/iata_airlines.csv
 *
 * Usage: node scripts/build-airlines.js
 * Input:  data/data-sources/iata-airlines.csv (caret-delimited)
 * Output: public/airlines.json
 */

import { readFileSync, writeFileSync } from 'fs'

const input = readFileSync('data/data-sources/iata-airlines.csv', 'utf-8')
const lines = input.trim().split('\n')

// Manual corrections for known errors in the source data
const patches = {
  'LH': { name: 'Lufthansa', icao: 'DLH' },           // Source has "Lufthansa Cargo"
  'AZ': { name: 'ITA Airways', icao: 'ITY' },          // Source has "Alitalia" (defunct 2021)
  'LX': { name: 'Swiss', icao: 'SWR' },                // Source has "Swiss International Air Lines"
  'TP': { name: 'TAP Air Portugal', icao: 'TAP' },     // Source has "TAP Portugal" (rebranded 2017)
}

// GDS and tech systems that aren't real airlines
const excludeCodes = new Set([
  '1A', '1B', '1C', '1D', '1E', '1F', '1G', '1H', '1J', '1K', '1L', '1O', '1P', '1S', '1V', '1W', '1Y',
  'H1', 'V1', 'S1', 'T1', 'GC',  // Hahn Air Systems, IBS Software, Lufthansa Systems, Tik Systems, Global Feeder Services
])

// Skip header
const airlines = []
for (let i = 1; i < lines.length; i++) {
  const [iata, icao, name, alias] = lines[i].split('^')

  // Skip entries without a valid 2-letter IATA code
  if (!iata || iata.length !== 2) continue

  // Skip entries without a name
  if (!name || !name.trim()) continue

  // Skip GDS/tech systems
  if (excludeCodes.has(iata.trim())) continue

  // Apply patches
  const patch = patches[iata.trim()]
  const entry = {
    iata: iata.trim(),
    name: patch?.name || name.trim(),
  }
  const finalIcao = patch?.icao || (icao && icao.trim())
  if (finalIcao) entry.icao = finalIcao
  if (!patch && alias && alias.trim()) entry.alias = alias.trim()

  airlines.push(entry)
}

// Sort alphabetically by name
airlines.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync('public/airlines.json', JSON.stringify(airlines))

console.log(`Built public/airlines.json: ${airlines.length} airlines`)
