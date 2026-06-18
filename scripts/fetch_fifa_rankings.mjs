import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const teamsPath = path.join(root, 'data', 'teams_2026.csv');
const teams = readCsv(teamsPath);
const normalizeTeam = (value) => value
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const aliases = new Map([
  ['czech republic', 'Czechia'],
  ['turkey', 'Türkiye'],
  ['cape verde', 'Cabo Verde'],
  ['congo dr', 'DR Congo'],
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': 'world-cup-2026-prediction/0.1 (public research project)' },
    });
    if (response.ok) return response;
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) {
      return response;
    }
    await sleep(attempt * 1500);
  }
  throw new Error('Unreachable retry state');
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ');
}

function cleanText(value) {
  return decodeHtml(
    value
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function cells(row) {
  return [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((match) => cleanText(match[1]));
}

const rankings = new Map();
for (const group of 'ABCDEFGHIJKL') {
  const apiUrl =
    `https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_Group_${group}` +
    '&prop=text&format=json&origin=*';
  const response = await fetchWithRetry(apiUrl);
  if (!response.ok) throw new Error(`Group ${group} request failed: ${response.status}`);
  const payload = await response.json();
  const html = payload.parse?.text?.['*'] ?? '';
  const teamsHeading = html.indexOf('id="Teams"');
  const table = html.slice(teamsHeading).match(
    /<table\b[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/i,
  )?.[0];
  if (!table) throw new Error(`Team table missing for Group ${group}`);
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const values = cells(row[1]);
    if (values.length !== 11 || !new RegExp(`^${group}[1-4]$`).test(values[0])) continue;
    const sourceTeam = values[1];
    const team = aliases.get(normalizeTeam(sourceTeam)) ?? sourceTeam;
    rankings.set(normalizeTeam(team), {
      fifa_rank_nov_2025: values[9],
      fifa_rank_june_2026: values[10],
    });
  }
  await sleep(400);
}

const updated = teams.map((team) => {
  const ranking = rankings.get(normalizeTeam(team.team));
  if (!ranking) return team;
  const juneRank = Number(ranking.fifa_rank_june_2026);
  const transformedRating = Math.max(1350, Math.round(1950 - (juneRank - 1) * 7.5));
  return {
    ...team,
    ...ranking,
    strength_rating: transformedRating,
    rating_basis: 'fifa_rank_june_2026_monotonic_transform_v1',
  };
});

const preferredHeaders = [
  'team', 'team_zh', 'group', 'head_coach', 'head_coach_zh',
  'assistant_coaches', 'assistant_status', 'fifa_rank_nov_2025',
  'fifa_rank_june_2026', 'strength_rating', 'rating_basis', 'host',
];
writeCsv(teamsPath, preferredHeaders, updated);
const matched = updated.filter((team) => team.fifa_rank_june_2026).length;
if (matched !== 48) throw new Error(`Only matched FIFA rankings for ${matched}/48 teams`);
console.log(`Imported June 2026 FIFA ranks for ${matched}/48 teams.`);
