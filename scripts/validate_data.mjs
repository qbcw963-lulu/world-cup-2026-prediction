import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const standings = readCsv(path.join(root, 'data', 'world_cup_2026_standings_2026-06-18.csv'));
const teams = readCsv(path.join(root, 'data', 'teams_2026.csv'));
const players = readCsv(path.join(root, 'data', 'players_2026.csv'));
const referees = readCsv(path.join(root, 'data', 'referees_2026.csv'));
const contexts = readCsv(path.join(root, 'data', 'match_context_2026.csv'));
const venues = readCsv(path.join(root, 'data', 'venues_2026.csv'));

const errors = [];
if (schedule.length !== 104) errors.push(`赛程应为 104 场，当前为 ${schedule.length}`);
if (standings.length !== 48) errors.push(`积分表应为 48 队，当前为 ${standings.length}`);
if (teams.length !== 48) errors.push(`球队表应为 48 队，当前为 ${teams.length}`);
if (players.length && (players.length < 1104 || players.length > 1248)) {
  errors.push(`球员总数应处于 1104–1248，当前为 ${players.length}`);
}
if (referees.length && referees.length !== 52) errors.push(`主裁判应为 52 人，当前为 ${referees.length}`);
if (contexts.length && contexts.length !== 72) errors.push(`小组赛上下文应为 72 场，当前为 ${contexts.length}`);
if (venues.length !== 16) errors.push(`球场应为 16 座，当前为 ${venues.length}`);

const ids = schedule.map((match) => Number(match.match_id)).sort((a, b) => a - b);
for (let i = 1; i <= 104; i += 1) {
  if (ids[i - 1] !== i) errors.push(`比赛编号缺失或重复：${i}`);
}

const teamNames = new Set(teams.map((team) => team.team));
for (const match of schedule.filter((item) => item.stage === 'Group stage')) {
  if (!teamNames.has(match.home)) errors.push(`球队主数据缺少：${match.home}`);
  if (!teamNames.has(match.away)) errors.push(`球队主数据缺少：${match.away}`);
}

for (const team of teams) {
  if (!team.head_coach) errors.push(`主教练缺失：${team.team}`);
  if (!Number.isFinite(Number(team.strength_rating))) errors.push(`强度评分无效：${team.team}`);
  if (!team.fifa_rank_june_2026) errors.push(`2026年6月FIFA排名缺失：${team.team}`);
  if (players.length) {
    const squadSize = players.filter((player) => player.team === team.team).length;
    if (squadSize < 23 || squadSize > 26) {
      errors.push(`${team.team} 的名单人数异常：${squadSize}`);
    }
  }
}

fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  `Data validation passed: 104 matches, 48 standings rows, 48 teams, ` +
  `${players.length} players, ${referees.length} referees, ${contexts.length} contexts.`,
);
