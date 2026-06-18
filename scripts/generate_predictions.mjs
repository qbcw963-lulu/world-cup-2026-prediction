import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const model = JSON.parse(fs.readFileSync(path.join(root, 'config', 'model.json'), 'utf8'));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const teams = readCsv(path.join(root, 'data', 'teams_2026.csv'));
const contexts = readCsv(path.join(root, 'data', 'match_context_2026.csv'));
const marketOdds = readCsv(path.join(root, 'data', 'market_odds_2026.csv'));
const teamByName = new Map(teams.map((team) => [team.team, team]));
const contextByMatch = new Map(contexts.map((context) => [context.match_id, context]));
const marketByMatch = new Map();
for (const row of marketOdds) {
  if (!row.home_decimal || !row.draw_decimal || !row.away_decimal) continue;
  const current = marketByMatch.get(row.match_id);
  if (!current || new Date(row.captured_at) > new Date(current.captured_at)) {
    marketByMatch.set(row.match_id, row);
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function factorial(value) {
  let result = 1;
  for (let i = 2; i <= value; i += 1) result *= i;
  return result;
}

function poisson(lambda, goals) {
  return Math.exp(-lambda) * (lambda ** goals) / factorial(goals);
}

function expectedGoals(home, away, context) {
  const ratingDifference = number(home.strength_rating) - number(away.strength_rating);
  const homeAdvantage = model.homeAdvantages[home.team] ?? model.homeAdvantages.default;
  const strengthMultiplier = Math.exp(ratingDifference / model.ratingScale);
  let homeXg = model.baseGoalsPerTeam * Math.sqrt(strengthMultiplier) + homeAdvantage;
  let awayXg = model.baseGoalsPerTeam / Math.sqrt(strengthMultiplier);

  homeXg += clamp(number(context?.home_lineup_adjustment), -model.adjustmentLimits.lineup, model.adjustmentLimits.lineup);
  awayXg += clamp(number(context?.away_lineup_adjustment), -model.adjustmentLimits.lineup, model.adjustmentLimits.lineup);
  homeXg += clamp(number(context?.home_motivation_adjustment), -model.adjustmentLimits.motivation, model.adjustmentLimits.motivation);
  awayXg += clamp(number(context?.away_motivation_adjustment), -model.adjustmentLimits.motivation, model.adjustmentLimits.motivation);
  homeXg += clamp(number(context?.home_rest_adjustment), -model.adjustmentLimits.rest, model.adjustmentLimits.rest);
  awayXg += clamp(number(context?.away_rest_adjustment), -model.adjustmentLimits.rest, model.adjustmentLimits.rest);

  const sharedAdjustment =
    clamp(number(context?.weather_goal_adjustment), -model.adjustmentLimits.weather, model.adjustmentLimits.weather) +
    clamp(number(context?.referee_goal_adjustment), -model.adjustmentLimits.referee, model.adjustmentLimits.referee);

  homeXg = clamp(homeXg + sharedAdjustment / 2, 0.2, 4.5);
  awayXg = clamp(awayXg + sharedAdjustment / 2, 0.2, 4.5);
  return { homeXg, awayXg };
}

function outcome(scoreHome, scoreAway) {
  if (scoreHome > scoreAway) return 'H';
  if (scoreHome < scoreAway) return 'A';
  return 'D';
}

function buildScoreMatrix(homeXg, awayXg, maxGoals = model.maxGoals) {
  const matrix = [];
  let total = 0;
  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      const probability = poisson(homeXg, homeGoals) * poisson(awayXg, awayGoals);
      matrix.push({ homeGoals, awayGoals, probability });
      total += probability;
    }
  }
  return matrix.map((score) => ({ ...score, probability: score.probability / total }));
}

function aggregateOneXTwo(matrix) {
  const result = { H: 0, D: 0, A: 0 };
  for (const score of matrix) result[outcome(score.homeGoals, score.awayGoals)] += score.probability;
  const drawDelta = result.D * (model.drawInflation - 1);
  result.D += drawDelta;
  result.H -= drawDelta * result.H / (result.H + result.A);
  result.A -= drawDelta * result.A / (result.H + result.A);
  return result;
}

function handicapOutcome(matrix, line) {
  const result = { H: 0, D: 0, A: 0 };
  for (const score of matrix) {
    const adjustedHome = score.homeGoals + line;
    if (adjustedHome > score.awayGoals) result.H += score.probability;
    else if (adjustedHome < score.awayGoals) result.A += score.probability;
    else result.D += score.probability;
  }
  return result;
}

function halfFull(homeXg, awayXg) {
  const firstHalf = buildScoreMatrix(homeXg * 0.45, awayXg * 0.45, 5);
  const secondHalf = buildScoreMatrix(homeXg * 0.55, awayXg * 0.55, 5);
  const result = {};
  for (const first of firstHalf) {
    for (const second of secondHalf) {
      const half = outcome(first.homeGoals, first.awayGoals);
      const full = outcome(
        first.homeGoals + second.homeGoals,
        first.awayGoals + second.awayGoals,
      );
      const key = `${half}/${full}`;
      result[key] = (result[key] ?? 0) + first.probability * second.probability;
    }
  }
  return result;
}

function pct(value) {
  return (value * 100).toFixed(1);
}

function marketProbabilities(row) {
  if (!row) return null;
  const raw = {
    H: 1 / Number(row.home_decimal),
    D: 1 / Number(row.draw_decimal),
    A: 1 / Number(row.away_decimal),
  };
  const total = raw.H + raw.D + raw.A;
  return { H: raw.H / total, D: raw.D / total, A: raw.A / total };
}

const outcomeZh = { H: '主胜', D: '平局', A: '客胜' };
const handicapZh = { H: '让胜', D: '让平', A: '让负' };
const halfFullZh = {
  'H/H': '胜/胜', 'H/D': '胜/平', 'H/A': '胜/负',
  'D/H': '平/胜', 'D/D': '平/平', 'D/A': '平/负',
  'A/H': '负/胜', 'A/D': '负/平', 'A/A': '负/负',
};

const generatedAt = new Date().toISOString();
const predictions = [];
for (const match of schedule.filter((item) => item.status === 'scheduled')) {
  const home = teamByName.get(match.home);
  const away = teamByName.get(match.away);
  if (!home || !away) continue;
  const context = contextByMatch.get(match.match_id);
  const { homeXg, awayXg } = expectedGoals(home, away, context);
  const matrix = buildScoreMatrix(homeXg, awayXg);
  const modelOneXTwo = aggregateOneXTwo(matrix);
  const marketRow = marketByMatch.get(match.match_id);
  const market = marketProbabilities(marketRow);
  const marketWeight = market ? 0.25 : 0;
  const oneXTwo = {
    H: modelOneXTwo.H * (1 - marketWeight) + (market?.H ?? 0) * marketWeight,
    D: modelOneXTwo.D * (1 - marketWeight) + (market?.D ?? 0) * marketWeight,
    A: modelOneXTwo.A * (1 - marketWeight) + (market?.A ?? 0) * marketWeight,
  };
  const topOutcome = Object.entries(oneXTwo).sort((a, b) => b[1] - a[1])[0][0];
  const topScore = [...matrix]
    .filter((score) => outcome(score.homeGoals, score.awayGoals) === topOutcome)
    .sort((a, b) => b.probability - a.probability)[0];
  const halfFullProbabilities = halfFull(homeXg, awayXg);
  const topHalfFull = Object.entries(halfFullProbabilities).sort((a, b) => b[1] - a[1])[0];
  const handicapLine = oneXTwo.H - oneXTwo.A >= 0.15
    ? -1
    : oneXTwo.A - oneXTwo.H >= 0.15
      ? 1
      : 0;
  const handicap = handicapOutcome(matrix, handicapLine);
  const topHandicap = Object.entries(handicap).sort((a, b) => b[1] - a[1])[0];
  const qualitySignals = [
    Boolean(context),
    context?.weather_status === 'open_meteo_forecast',
    Boolean(context?.referee),
    Boolean(context?.referee_cards_per_match),
    context?.motivation_basis?.startsWith('standings_snapshot'),
    context?.home_lineup_adjustment !== '' && context?.away_lineup_adjustment !== '',
  ];
  const completeness = qualitySignals.filter(Boolean).length / qualitySignals.length;
  const limitations = [
    !context?.referee && '裁判任命待公布',
    context?.referee && !context?.referee_cards_per_match && '裁判历史量化样本待补',
    context?.weather_status !== 'open_meteo_forecast' && '天气超出可靠预报窗口',
    !market && '当前比赛尚无完整三项官网赔率快照',
    '最终首发需赛前刷新',
  ].filter(Boolean).join('；');
  const ratingGap = Number(home.strength_rating) - Number(away.strength_rating);
  const factors = [
    `FIFA排名强度差修正=${ratingGap > 0 ? '+' : ''}${ratingGap}`,
    model.homeAdvantages[home.team] ? `${home.team}东道主优势` : '',
    Number(context?.home_lineup_adjustment) < 0
      ? `${home.team}伤停/停赛修正${context.home_lineup_adjustment}`
      : '',
    Number(context?.away_lineup_adjustment) < 0
      ? `${away.team}伤停/停赛修正${context.away_lineup_adjustment}`
      : '',
    Number(context?.home_rest_adjustment) !== 0
      ? `休息与旅行主队修正${context.home_rest_adjustment}`
      : '',
    Number(context?.weather_goal_adjustment) < 0
      ? `天气压低总进球${context.weather_goal_adjustment}`
      : '',
    context?.referee
      ? `裁判=${context.referee}${context.referee_cards_per_match ? `，本届黄牌均值${context.referee_cards_per_match}` : ''}`
      : '',
    `战意依据=${context?.motivation_basis ?? '待更新'}`,
  ].filter(Boolean).join('；');

  predictions.push({
    generated_at: generatedAt,
    match_id: match.match_id,
    date: match.date,
    home: match.home,
    away: match.away,
    home_xg: homeXg.toFixed(2),
    away_xg: awayXg.toFixed(2),
    home_win_pct: pct(oneXTwo.H),
    draw_pct: pct(oneXTwo.D),
    away_win_pct: pct(oneXTwo.A),
    model_home_win_pct: pct(modelOneXTwo.H),
    model_draw_pct: pct(modelOneXTwo.D),
    model_away_win_pct: pct(modelOneXTwo.A),
    market_home_win_pct: market ? pct(market.H) : '',
    market_draw_pct: market ? pct(market.D) : '',
    market_away_win_pct: market ? pct(market.A) : '',
    market_bookmaker: marketRow?.bookmaker ?? '',
    market_snapshot_at: marketRow?.captured_at ?? '',
    market_weight_pct: pct(marketWeight),
    predicted_1x2: topOutcome,
    predicted_1x2_zh: outcomeZh[topOutcome],
    predicted_score: `${topScore.homeGoals}-${topScore.awayGoals}`,
    predicted_score_pct: pct(topScore.probability),
    home_handicap_line: String(handicapLine),
    handicap_home_pct: pct(handicap.H),
    handicap_draw_pct: pct(handicap.D),
    handicap_away_pct: pct(handicap.A),
    predicted_handicap: topHandicap[0],
    predicted_handicap_zh: handicapZh[topHandicap[0]],
    handicap_basis: 'model_generated_line_not_official_lottery_line',
    predicted_half_full: topHalfFull[0],
    predicted_half_full_zh: halfFullZh[topHalfFull[0]],
    predicted_half_full_pct: pct(topHalfFull[1]),
    context_status: context ? 'context_loaded' : 'baseline_only',
    data_completeness_pct: pct(completeness),
    key_factors: factors,
    limitations,
    model_version: model.version,
  });
}

const headers = Object.keys(predictions[0] ?? {});
writeCsv(path.join(root, 'outputs', 'predictions_latest.csv'), headers, predictions);
console.log(`Generated ${predictions.length} pre-match predictions.`);
