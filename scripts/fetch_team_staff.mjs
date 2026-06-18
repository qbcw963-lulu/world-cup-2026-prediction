import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const teamsPath = path.join(root, 'data', 'teams_2026.csv');
const teams = readCsv(teamsPath);
const staffPath = path.join(root, 'data', 'team_staff_2026.csv');
const existingStaff = readCsv(staffPath);
const missingOnly = process.argv.includes('--missing-only');

const pageAliases = new Map([
  ['Czechia', 'Czech_Republic_national_football_team'],
  ['South Africa', 'South_Africa_national_soccer_team'],
  ['South Korea', 'South_Korea_national_football_team'],
  ['Canada', 'Canada_men%27s_national_soccer_team'],
  ['United States', 'United_States_men%27s_national_soccer_team'],
  ['Australia', 'Australia_men%27s_national_soccer_team'],
  ['Türkiye', 'Turkey_national_football_team'],
  ['Ivory Coast', 'Ivory_Coast_national_football_team'],
  ['Curaçao', 'Cura%C3%A7ao_national_football_team'],
  ['Cabo Verde', 'Cape_Verde_national_football_team'],
  ['DR Congo', 'DR_Congo_national_football_team'],
]);

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name] ?? entity);
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
    .map((match) => match[1]);
}

function lastAnchorText(value) {
  const anchors = [...value.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  return anchors.length ? cleanText(anchors.at(-1)[1]) : cleanText(value);
}

function nationality(value) {
  return decodeHtml(value.match(/<img\b[^>]*alt="([^"]+)"/i)?.[1] ?? '');
}

function wikiPage(team) {
  return pageAliases.get(team) ?? `${team.replaceAll(' ', '_')}_national_football_team`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': 'world-cup-2026-prediction/0.1 (public research project)' },
    });
    if (response.ok) return response;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
      return response;
    }
    await sleep(attempt * 1500);
  }
  throw new Error('Unreachable retry state');
}

const staff = missingOnly ? [...existingStaff] : [];
const updatedTeams = [];
for (const team of teams) {
  if (missingOnly && team.assistant_coaches) {
    updatedTeams.push(team);
    continue;
  }
  if (missingOnly) {
    for (let index = staff.length - 1; index >= 0; index -= 1) {
      if (staff[index].team === team.team) staff.splice(index, 1);
    }
  }
  const page = wikiPage(team.team);
  const sourceUrl = `https://en.wikipedia.org/wiki/${page}`;
  const apiUrl =
    `https://en.wikipedia.org/w/api.php?action=parse&page=${page}` +
    '&prop=text|revid&format=json&origin=*';
  const response = await fetchWithRetry(apiUrl);
  let assistantNames = [];
  let status = response.ok ? 'missing_coaching_staff_section' : `source_http_${response.status}`;
  if (response.ok) {
    const payload = await response.json();
    const html = payload.parse?.text?.['*'] ?? '';
    const heading = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
      .find((match) => /coaching staff|current personnel|current staff/i.test(cleanText(match[1])));
    if (heading) {
      const start = heading.index + heading[0].length;
      const end = html.indexOf('<h2', start);
      const section = html.slice(start, end === -1 ? undefined : end);
      const sourceAsOf = cleanText(section.match(/As of ([^<]+)/i)?.[1] ?? '');
      const table = section.match(/<table\b[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/i);
      if (table) {
        for (const row of table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const rowCells = cells(row[1]);
          if (rowCells.length < 2) continue;
          const role = cleanText(rowCells[0]);
          const name = lastAnchorText(rowCells[1]);
          if (!role || !name || /position/i.test(role)) continue;
          staff.push({
            team: team.team,
            role,
            staff_name: name,
            nationality: nationality(rowCells[1]),
            source_url: sourceUrl,
            source_as_of: sourceAsOf,
            verified_at: new Date().toISOString(),
            status: 'secondary_source_requires_federation_confirmation',
          });
          if (/assistant|coach/i.test(role) && !/head coach|manager/i.test(role)) {
            assistantNames.push(`${role}: ${name}`);
          }
        }
        status = assistantNames.length
          ? 'secondary_source_requires_federation_confirmation'
          : 'no_assistant_role_found';
      }
    }
  }
  updatedTeams.push({
    ...team,
    assistant_coaches: assistantNames.join('; '),
    assistant_status: status,
  });
  await sleep(350);
}

writeCsv(
  staffPath,
  ['team', 'role', 'staff_name', 'nationality', 'source_url', 'source_as_of', 'verified_at', 'status'],
  staff,
);
writeCsv(teamsPath, Object.keys(updatedTeams[0]), updatedTeams);
console.log(`Imported ${staff.length} staff records; ${updatedTeams.filter((t) => t.assistant_coaches).length}/48 teams have assistant/coach entries.`);
