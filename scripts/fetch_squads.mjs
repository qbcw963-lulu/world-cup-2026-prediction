import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const teams = readCsv(path.join(root, 'data', 'teams_2026.csv'));
const sourceUrl = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads';
const apiUrl =
  'https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_squads' +
  '&prop=text&format=json&origin=*';

const aliases = new Map([
  ['Czechia', 'Czech Republic'],
  ['Türkiye', 'Turkey'],
  ['Cabo Verde', 'Cape Verde'],
]);

function decodeHtml(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    ndash: '–',
    mdash: '—',
  };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name] ?? entity);
}

function cleanText(value) {
  return decodeHtml(
    value
      .replace(/<span[^>]*style="display:none"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<sup[\s\S]*?<\/sup>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractCells(rowHtml) {
  return [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((match) => match[1]);
}

function extractLastAnchorText(value) {
  const anchors = [...value.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  return anchors.length ? cleanText(anchors.at(-1)[1]) : cleanText(value);
}

function extractPlayerName(value) {
  const anchor = value.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  return anchor ? cleanText(anchor[1]) : cleanText(value).replace(/\s*\(captain\)\s*/i, '');
}

function extractWikipediaTitle(value) {
  const href = value.match(/<a\b[^>]*href="\/wiki\/([^"#?]+)"/i)?.[1] ?? '';
  return decodeURIComponent(href);
}

function extractDateOfBirth(value) {
  return value.match(/class="bday">(\d{4}-\d{2}-\d{2})</i)?.[1] ?? '';
}

function extractClubCountry(value) {
  return decodeHtml(value.match(/<img\b[^>]*alt="([^"]+)"/i)?.[1] ?? '');
}

const response = await fetch(apiUrl, {
  headers: { 'user-agent': 'world-cup-2026-prediction/0.1 (public research project)' },
});
if (!response.ok) throw new Error(`Squad request failed: HTTP ${response.status}`);
const payload = await response.json();
const html = payload.parse?.text?.['*'];
if (!html) throw new Error('Squad page did not contain parsed HTML');

const fetchedAt = new Date().toISOString();
const players = [];
for (const team of teams) {
  const heading = aliases.get(team.team) ?? team.team;
  const headingMatch = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)]
    .find((match) => cleanText(match[1]) === heading);
  if (!headingMatch) throw new Error(`Could not find squad heading for ${team.team}`);
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeading = html.indexOf('<h3', sectionStart);
  const section = html.slice(sectionStart, nextHeading === -1 ? undefined : nextHeading);
  const tableMatch = section.match(/<table\b[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error(`Could not find squad table for ${team.team}`);

  const playerRows = [...tableMatch[0].matchAll(/<tr\b[^>]*class="[^"]*nat-fs-player[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (playerRows.length < 23 || playerRows.length > 26) {
    throw new Error(`${team.team} has unexpected squad size ${playerRows.length}`);
  }

  for (const playerRow of playerRows) {
    const cells = extractCells(playerRow[1]);
    if (cells.length < 7) throw new Error(`Invalid player row for ${team.team}`);
    players.push({
      team: team.team,
      squad_number: cleanText(cells[0]),
      player_name: extractPlayerName(cells[2]),
      player_name_zh: '',
      player_name_zh_status: 'pending_wikidata',
      wikipedia_title: extractWikipediaTitle(cells[2]),
      position: cleanText(cells[1]).replace(/^\d+/, ''),
      date_of_birth: extractDateOfBirth(cells[3]),
      club: extractLastAnchorText(cells[6]),
      club_country: extractClubCountry(cells[6]),
      caps: cleanText(cells[4]),
      goals: cleanText(cells[5]),
      squad_status: 'final_squad',
      availability: 'available_unless_updated',
      source_url: sourceUrl,
      verified_at: fetchedAt,
    });
  }
}

const headers = [
  'team', 'squad_number', 'player_name', 'player_name_zh', 'player_name_zh_status',
  'wikipedia_title', 'position',
  'date_of_birth', 'club', 'club_country', 'caps', 'goals', 'squad_status',
  'availability', 'source_url', 'verified_at',
];
writeCsv(path.join(root, 'data', 'players_2026.csv'), headers, players);
console.log(`Imported ${players.length} players across ${teams.length} teams.`);
