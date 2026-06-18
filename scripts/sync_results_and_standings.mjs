import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedulePath = path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv');
const standingsPath = path.join(root, 'data', 'world_cup_2026_standings_2026-06-18.csv');
const schedule = readCsv(schedulePath);
const teams = readCsv(path.join(root, 'data', 'teams_2026.csv'));
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

let updatedMatches = 0;
for (const group of 'ABCDEFGHIJKL') {
  const html = await fetchGroup(group);
  const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = cleanText(headings[index][1]);
    if (!/ vs /.test(heading)) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const scoreText = cleanText(section.match(/class="fscore">([\s\S]*?)<\/th>/i)?.[1] ?? '');
    const score = scoreText.match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (!score) continue;
    const match = schedule.find((item) =>
      item.group === group &&
      normalize(heading) === normalize(`${item.home} vs ${item.away}`));
    if (!match) continue;
    if (
      match.home_score !== score[1] ||
      match.away_score !== score[2] ||
      match.status !== 'finished'
    ) {
      updatedMatches += 1;
    }
    match.home_score = score[1];
    match.away_score = score[2];
    match.status = 'finished';
  }
  await sleep(350);
}

writeCsv(schedulePath, Object.keys(schedule[0]), schedule);

const table = [];
for (const group of 'ABCDEFGHIJKL') {
  const groupTeams = teams.filter((team) => team.group === group).map((team) => ({
    snapshot_date: new Date().toISOString().slice(0, 10),
    group,
    rank: 0,
    team: team.team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
  }));
  const byName = new Map(groupTeams.map((team) => [team.team, team]));
  for (const match of schedule.filter((item) => item.group === group && item.status === 'finished')) {
    const home = byName.get(match.home);
    const away = byName.get(match.away);
    if (!home || !away) continue;
    const homeGoals = Number(match.home_score);
    const awayGoals = Number(match.away_score);
    home.played += 1;
    away.played += 1;
    home.goals_for += homeGoals;
    home.goals_against += awayGoals;
    away.goals_for += awayGoals;
    away.goals_against += homeGoals;
    if (homeGoals > awayGoals) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (homeGoals < awayGoals) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  for (const team of groupTeams) {
    team.goal_difference = team.goals_for - team.goals_against;
  }
  groupTeams.sort((a, b) =>
    b.points - a.points ||
    b.goal_difference - a.goal_difference ||
    b.goals_for - a.goals_for ||
    a.team.localeCompare(b.team));
  groupTeams.forEach((team, index) => { team.rank = index + 1; });
  table.push(...groupTeams);
}

writeCsv(standingsPath, Object.keys(table[0]), table);
console.log(`Results synced; ${updatedMatches} matches changed. Standings rebuilt.`);
