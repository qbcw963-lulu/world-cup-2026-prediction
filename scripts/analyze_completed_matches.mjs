import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const model = JSON.parse(fs.readFileSync(path.join(root, 'config', 'model.json'), 'utf8'));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const teams = readCsv(path.join(root, 'data', 'teams_2026.csv'));
const teamByName = new Map(teams.map((team) => [team.team, team]));

function logisticExpected(ratingDifference) {
  return 1 / (1 + 10 ** (-ratingDifference / model.ratingScale));
}

function probabilities(home, away) {
  const homeBonus = home.host === 'true' ? 65 : 0;
  const expected = logisticExpected(
    Number(home.strength_rating) + homeBonus - Number(away.strength_rating),
  );
  const draw = Math.max(0.18, 0.29 - Math.abs(expected - 0.5) * 0.22);
  return {
    H: expected * (1 - draw),
    D: draw,
    A: (1 - expected) * (1 - draw),
  };
}

function result(homeScore, awayScore) {
  if (homeScore > awayScore) return 'H';
  if (homeScore < awayScore) return 'A';
  return 'D';
}

function classification(probability) {
  if (probability < model.upsetThresholds.major) return '重大爆冷 / Major upset';
  if (probability < model.upsetThresholds.moderate) return '中等爆冷 / Moderate upset';
  if (probability < model.upsetThresholds.minor) return '轻度爆冷 / Minor upset';
  return '正常赛果 / Expected result';
}

const rows = [];
for (const match of schedule.filter((item) => item.status === 'finished')) {
  const home = teamByName.get(match.home);
  const away = teamByName.get(match.away);
  if (!home || !away) continue;
  const p = probabilities(home, away);
  const actualResult = result(Number(match.home_score), Number(match.away_score));
  const actualProbability = p[actualResult];
  rows.push({
    match_id: match.match_id,
    date: match.date,
    group: match.group,
    home: match.home,
    away: match.away,
    score: `${match.home_score}-${match.away_score}`,
    actual_result: actualResult,
    pre_match_home_pct: (p.H * 100).toFixed(1),
    pre_match_draw_pct: (p.D * 100).toFixed(1),
    pre_match_away_pct: (p.A * 100).toFixed(1),
    actual_result_pre_match_pct: (actualProbability * 100).toFixed(1),
    classification: classification(actualProbability),
    classification_basis: 'model_only_initial_prior',
    caveat: '待补充赛前收盘赔率与正式 Elo 后重新校准',
  });
}

const headers = Object.keys(rows[0] ?? {});
writeCsv(path.join(root, 'outputs', 'completed_match_upset_analysis.csv'), headers, rows);
console.log(`Classified ${rows.length} completed matches.`);
