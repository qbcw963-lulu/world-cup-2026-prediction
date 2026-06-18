import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const outputPath = path.join(root, 'data', 'market_odds_2026.csv');
const existing = readCsv(outputPath);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const apiBase = 'https://dknetwork.draftkings.com/wp-json/wp/v2/posts';
const debugMatch = process.env.DEBUG_ODDS_MATCH;

const aliases = new Map([
  ['United States', ['United States', 'USA', 'USMNT', 'Americans']],
  ['South Korea', ['South Korea', 'Korea Republic']],
  ['Türkiye', ['Türkiye', 'Turkey']],
  ['Ivory Coast', ['Ivory Coast', "Côte d'Ivoire", 'Cote d’Ivoire']],
  ['Curaçao', ['Curaçao', 'Curacao']],
  ['Cabo Verde', ['Cabo Verde', 'Cape Verde']],
  ['DR Congo', ['DR Congo', 'Congo DR']],
  ['Spain', ['Spain', 'La Roja']],
  ['Colombia', ['Colombia', 'Colombians']],
  ['Uzbekistan', ['Uzbekistan', 'Uzbeks']],
]);

function decodeHtml(value) {
  const entities = {
    '&#8211;': '–', '&#8212;': '—', '&#8217;': "'", '&#8220;': '"',
    '&#8221;': '"', '&amp;': '&', '&nbsp;': ' ', '&#8242;': "'",
  };
  let result = value;
  for (const [entity, replacement] of Object.entries(entities)) {
    result = result.replaceAll(entity, replacement);
  }
  return result.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function cleanHtml(value) {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamAliases(team) {
  return aliases.get(team) ?? [team];
}

function hasTeam(text, team) {
  const normalized = normalize(text);
  return teamAliases(team).some((alias) => normalized.includes(normalize(alias)));
}

function americanToDecimal(value) {
  const odds = Number(value);
  if (odds > 0) return (1 + odds / 100).toFixed(4);
  return (1 + 100 / Math.abs(odds)).toFixed(4);
}

function extractOddsNear(paragraphs, team) {
  const candidates = [];
  for (const paragraph of paragraphs) {
    if (!/moneyline|favorite|underdog|odds|outright/i.test(paragraph)) continue;
    for (const alias of teamAliases(team)) {
      const pattern = new RegExp(
        `${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.{0,140}?)([+−-]\\d{3,4})(?!\\d)`,
        'gi',
      );
      for (const match of paragraph.matchAll(pattern)) {
        const bridge = match[1].toLowerCase();
        const score =
          (/moneyline|favorite|underdog|odds|outright|listed|sitting|priced|comes|opens|have|pegged|\bis\b|\bare\b/.test(bridge) ? 5 : 0) +
          (match[1].length < 70 ? 2 : 0) +
          (hasTeam(paragraph, team) ? 1 : 0);
        candidates.push({
          american: match[2].replace('−', '-'),
          excerpt: match[0],
          paragraph,
          score,
        });
      }
    }
  }
  return candidates
    .filter((candidate) => candidate.score >= 6)
    .sort((a, b) => b.score - a.score || a.excerpt.length - b.excerpt.length)[0];
}

function extractDrawOdds(paragraphs) {
  const patterns = [
    /(?:the\s+)?draw(?:\s+is|\s+listed\s+at|\s+are|\s+priced\s+at|\s+odds.{0,20}?)(?:.{0,60}?)([+−-]\d{3,4})/gi,
    /([+−-]\d{3,4})\s+odds\s+that\s+the\s+teams\s+will\s+draw/gi,
    /odds\s+of\s+(?:a|the)\s+draw.{0,80}?([+−-]\d{3,4})/gi,
    /odds\s+of.{0,100}?(?:draw|finishing\s+in\s+a\s+draw).{0,80}?([+−-]\d{3,4})/gi,
  ];
  for (const paragraph of paragraphs.filter((item) =>
    /draw|teams will draw/i.test(item) && /odds|listed|priced|\+\d{3,4}/i.test(item))) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(paragraph);
      if (match) return { american: match[1].replace('−', '-'), paragraph };
    }
  }
  return null;
}

function extractSpread(text, favorite) {
  const aliasesPattern = teamAliases(favorite)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const match = new RegExp(
    `(?:${aliasesPattern}).{0,220}?(?:spread favorite at|cover the|spread at|enters at)\\s*(-?\\d+(?:\\.5)?)`,
    'i',
  ).exec(text);
  return match?.[1] ?? '';
}

async function fetchJson(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': 'world-cup-2026-prediction/0.1 (public research project)' },
    });
    if (response.ok) return response.json();
    if (attempt < attempts) await sleep(attempt * 1200);
  }
  return null;
}

const posts = [];
for (let page = 1; page <= 3; page += 1) {
  const query = new URLSearchParams({
    search: 'World Cup odds',
    per_page: '100',
    page: String(page),
    after: '2026-06-01T00:00:00',
  });
  const batch = await fetchJson(`${apiBase}?${query}`);
  if (!Array.isArray(batch) || batch.length === 0) break;
  posts.push(...batch);
  await sleep(250);
}

const rows = [];
for (const match of schedule) {
  const candidates = posts
    .filter((post) => {
      const title = cleanHtml(post.title?.rendered ?? '');
      return (
        hasTeam(title, match.home) &&
        hasTeam(title, match.away) &&
        !/tracker|live updates|lineups|game recap/i.test(title)
      );
    })
    .sort((a, b) => {
      const aOpening = /opening odds/i.test(cleanHtml(a.title?.rendered ?? '')) ? 1 : 0;
      const bOpening = /opening odds/i.test(cleanHtml(b.title?.rendered ?? '')) ? 1 : 0;
      return bOpening - aOpening || new Date(a.date_gmt) - new Date(b.date_gmt);
    });
  if (!candidates.length) continue;

  for (const post of candidates) {
    const text = cleanHtml(post.content?.rendered ?? '');
    const paragraphs = [...(post.content?.rendered ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((item) => cleanHtml(item[1]))
      .filter(Boolean);
    const home = extractOddsNear(paragraphs, match.home);
    const away = extractOddsNear(paragraphs, match.away);
    const draw = extractDrawOdds(paragraphs);
    if (debugMatch === match.match_id) {
      console.log(JSON.stringify({
        match: match.match_id,
        title: cleanHtml(post.title?.rendered ?? ''),
        home,
        draw,
        away,
      }, null, 2));
    }
    if (!home?.american || !away?.american || !draw?.american) continue;
    const homeAmerican = home.american;
    const awayAmerican = away.american;
    const drawAmerican = draw.american;
    if (new Set([homeAmerican, drawAmerican, awayAmerican]).size !== 3) continue;
    const homeFavorite = Number(homeAmerican) < Number(awayAmerican);
    const favorite = homeFavorite ? match.home : match.away;
    const spread = extractSpread(text, favorite);
    const sourceExcerpt = [...new Set([home.paragraph, draw.paragraph, away.paragraph])]
      .join(' ');

    rows.push({
      match_id: match.match_id,
      captured_at: post.date_gmt ? `${post.date_gmt}Z` : post.date,
      bookmaker: 'DraftKings Sportsbook',
      snapshot_type: /opening odds/i.test(cleanHtml(post.title?.rendered ?? ''))
        ? 'opening'
        : 'published_article_snapshot',
      home_american: homeAmerican,
      draw_american: drawAmerican,
      away_american: awayAmerican,
      home_decimal: americanToDecimal(homeAmerican),
      draw_decimal: americanToDecimal(drawAmerican),
      away_decimal: americanToDecimal(awayAmerican),
      asian_handicap_home_line: spread
        ? String(homeFavorite ? Number(spread) : -Number(spread))
        : '',
      asian_handicap_home_decimal: '',
      asian_handicap_away_decimal: '',
      extraction_confidence: 'high_team_named_moneyline_context',
      source_excerpt: sourceExcerpt.slice(0, 800),
      source_url: post.link,
    });
    break;
  }
}

const retained = existing.filter((row) => row.bookmaker !== 'DraftKings Sportsbook');
const headers = [
  'match_id', 'captured_at', 'bookmaker', 'snapshot_type',
  'home_american', 'draw_american', 'away_american',
  'home_decimal', 'draw_decimal', 'away_decimal',
  'asian_handicap_home_line', 'asian_handicap_home_decimal',
  'asian_handicap_away_decimal', 'extraction_confidence',
  'source_excerpt', 'source_url',
];
writeCsv(outputPath, headers, [...retained, ...rows]);
console.log(`Imported ${rows.length} DraftKings official published odds snapshots.`);
