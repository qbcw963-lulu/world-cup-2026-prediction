import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const refereePath = path.join(root, 'data', 'referees_2026.csv');
const referees = readCsv(refereePath);
const stats = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function fetchGroup(group) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_Group_${group}` +
    '&prop=text&format=json&origin=*';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': 'world-cup-2026-prediction/0.1 (public research project)' },
    });
    if (response.ok) return (await response.json()).parse?.text?.['*'] ?? '';
    if (attempt < 5) await sleep(attempt * 1500);
  }
  return '';
}

for (const group of 'ABCDEFGHIJKL') {
  const html = await fetchGroup(group);
  if (!html) continue;
  const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = cleanText(headings[index][1]);
    if (!/ vs /.test(heading)) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const refereeName = cleanText(
      section.match(/Referee:\s*<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '',
    );
    if (!refereeName) continue;
    const match = schedule.find((item) =>
      item.group === group &&
      item.status === 'finished' &&
      normalize(heading) === normalize(`${item.home} vs ${item.away}`));
    if (!match) continue;
    const yellowCards = (section.match(/alt="Yellow card"/gi) ?? []).length;
    const straightReds = (section.match(/alt="Red card"/gi) ?? []).length;
    const secondYellowReds = (section.match(/alt="Second yellow card"/gi) ?? []).length;
    const current = stats.get(normalize(refereeName)) ?? {
      matches: 0,
      yellow: 0,
      red: 0,
    };
    current.matches += 1;
    current.yellow += yellowCards;
    current.red += straightReds + secondYellowReds;
    stats.set(normalize(refereeName), current);
  }
  await sleep(350);
}

for (const referee of referees) {
  const sample = stats.get(normalize(referee.referee_name));
  if (!sample) continue;
  const yellowAverage = sample.yellow / sample.matches;
  const redAverage = sample.red / sample.matches;
  referee.historical_matches = sample.matches;
  referee.yellow_cards_per_match = yellowAverage.toFixed(2);
  referee.red_cards_per_match = redAverage.toFixed(2);
  referee.style_tags = sample.matches < 3
    ? 'tournament_sample_low_confidence'
    : yellowAverage >= 5
      ? 'card_strict_tournament_sample'
      : yellowAverage <= 3
        ? 'card_lenient_tournament_sample'
        : 'card_average_tournament_sample';
  referee.stats_source_url = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup';
  referee.status = `tournament_sample_${sample.matches}_career_stats_pending`;
}

writeCsv(refereePath, Object.keys(referees[0]), referees);
console.log(`Updated tournament-to-date card samples for ${stats.size} referees.`);
