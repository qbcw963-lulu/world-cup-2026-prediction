import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const apiKey = process.env.THE_ODDS_API_KEY;
if (!apiKey) {
  console.error(
    'THE_ODDS_API_KEY is not configured. No odds were fabricated. ' +
    'Create a licensed API key and set it before running npm run fetch:odds.',
  );
  process.exit(2);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const outputPath = path.join(root, 'data', 'market_odds_2026.csv');
const existing = readCsv(outputPath);
const query = new URLSearchParams({
  apiKey,
  regions: 'us,uk,eu',
  markets: 'h2h',
  oddsFormat: 'decimal',
  dateFormat: 'iso',
});
const response = await fetch(
  `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?${query}`,
);
if (!response.ok) throw new Error(`Odds request failed: HTTP ${response.status}`);
const events = await response.json();

function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const aliases = new Map([
  ['usa', 'united states'],
  ['korea republic', 'south korea'],
  ['turkey', 'turkiye'],
  ['cote d ivoire', 'ivory coast'],
  ['cape verde', 'cabo verde'],
  ['congo dr', 'dr congo'],
]);

function canonical(value) {
  const normalized = normalize(value);
  return aliases.get(normalized) ?? normalized;
}

const capturedAt = new Date().toISOString();
const imported = [];
for (const event of events) {
  const match = schedule.find((item) =>
    item.status === 'scheduled' &&
    canonical(item.home) === canonical(event.home_team) &&
    canonical(item.away) === canonical(event.away_team));
  if (!match) continue;
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((item) => item.key === 'h2h');
    if (!market) continue;
    const outcome = (name) =>
      market.outcomes.find((item) => canonical(item.name) === canonical(name))?.price ?? '';
    imported.push({
      match_id: match.match_id,
      captured_at: capturedAt,
      bookmaker: bookmaker.title,
      snapshot_type: 'live_api_snapshot',
      home_american: '',
      draw_american: '',
      away_american: '',
      home_decimal: outcome(event.home_team),
      draw_decimal: market.outcomes.find((item) => normalize(item.name) === 'draw')?.price ?? '',
      away_decimal: outcome(event.away_team),
      asian_handicap_home_line: '',
      asian_handicap_home_decimal: '',
      asian_handicap_away_decimal: '',
      extraction_confidence: 'licensed_api',
      source_excerpt: '',
      source_url: 'https://the-odds-api.com/',
    });
  }
}

const headers = [
  'match_id', 'captured_at', 'bookmaker', 'snapshot_type',
  'home_american', 'draw_american', 'away_american',
  'home_decimal', 'draw_decimal', 'away_decimal',
  'asian_handicap_home_line', 'asian_handicap_home_decimal',
  'asian_handicap_away_decimal', 'extraction_confidence',
  'source_excerpt', 'source_url',
];
writeCsv(outputPath, headers, [...existing, ...imported]);
console.log(`Imported ${imported.length} timestamped bookmaker snapshots.`);
