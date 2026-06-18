import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceUrl = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_officials';
const apiUrl =
  'https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_officials' +
  '&prop=text&format=json&origin=*';

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', ndash: '–' };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name] ?? entity);
}

function cleanText(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, '; ')
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function cells(row) {
  return [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((match) => match[1]);
}

function firstAnchor(value) {
  return cleanText(value.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? value);
}

function parentheticalCountry(value) {
  const text = cleanText(value);
  return text.match(/\(([^()]*)\)\s*$/)?.[1] ?? '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let response;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  response = await fetch(apiUrl, {
    headers: { 'user-agent': 'world-cup-2026-prediction/0.1 (public research project)' },
  });
  if (response.ok) break;
  if (attempt < 5) await sleep(attempt * 2000);
}
if (!response.ok) throw new Error(`Officials request failed: HTTP ${response.status}`);
const payload = await response.json();
const html = payload.parse?.text?.['*'] ?? '';
const table = html.match(/<table\b[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/i)?.[0];
if (!table) throw new Error('Officials table not found');

let confederation = '';
const referees = [];
for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const rowCells = cells(row[1]);
  if (rowCells.length < 4) continue;
  let offset = 0;
  if (/rowspan/i.test(rowCells[0]) || /^(AFC|CAF|CONCACAF|CONMEBOL|OFC|UEFA)$/.test(cleanText(rowCells[0]))) {
    confederation = cleanText(rowCells[0]);
    offset = 1;
  }
  if (rowCells.length - offset < 4) continue;
  const refereeCell = rowCells[offset];
  const refereeName = firstAnchor(refereeCell);
  if (!refereeName || /referees/i.test(refereeName)) continue;
  referees.push({
    referee_name: refereeName,
    referee_name_zh: '',
    nationality: parentheticalCountry(refereeCell),
    confederation,
    assistant_referees: cleanText(rowCells[offset + 1]),
    matches_assigned: cleanText(rowCells[offset + 2]),
    fourth_official_assignments: cleanText(rowCells[offset + 3]),
    historical_matches: '',
    yellow_cards_per_match: '',
    red_cards_per_match: '',
    penalties_per_match: '',
    fouls_per_match: '',
    home_win_rate: '',
    style_tags: '',
    stats_source_url: '',
    appointment_source_url: sourceUrl,
    verified_at: new Date().toISOString(),
    status: 'appointed_official_stats_pending',
  });
}

writeCsv(
  path.join(root, 'data', 'referees_2026.csv'),
  [
    'referee_name', 'referee_name_zh', 'nationality', 'confederation',
    'assistant_referees', 'matches_assigned', 'fourth_official_assignments',
    'historical_matches', 'yellow_cards_per_match', 'red_cards_per_match',
    'penalties_per_match', 'fouls_per_match', 'home_win_rate', 'style_tags',
    'stats_source_url', 'appointment_source_url', 'verified_at', 'status',
  ],
  referees,
);
console.log(`Imported ${referees.length} appointed referees.`);
