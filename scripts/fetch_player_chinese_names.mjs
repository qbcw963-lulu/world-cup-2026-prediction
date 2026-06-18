import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const playersPath = path.join(root, 'data', 'players_2026.csv');
const players = readCsv(playersPath);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const titleToEntity = new Map();
const titles = [...new Set(players.map((player) => player.wikipedia_title).filter(Boolean))];
for (let start = 0; start < titles.length; start += 50) {
  const batch = titles.slice(start, start + 50);
  const params = new URLSearchParams({
    action: 'query',
    titles: batch.join('|'),
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  const payload = await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`);
  for (const page of Object.values(payload?.query?.pages ?? {})) {
    if (page.title && page.pageprops?.wikibase_item) {
      titleToEntity.set(page.title.replaceAll(' ', '_'), page.pageprops.wikibase_item);
    }
  }
  for (const redirect of payload?.query?.redirects ?? []) {
    const entity = titleToEntity.get(redirect.to.replaceAll(' ', '_'));
    if (entity) titleToEntity.set(redirect.from.replaceAll(' ', '_'), entity);
  }
  await sleep(250);
}

const entityToZh = new Map();
const entityIds = [...new Set(titleToEntity.values())];
for (let start = 0; start < entityIds.length; start += 50) {
  const batch = entityIds.slice(start, start + 50);
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: batch.join('|'),
    props: 'labels',
    languages: 'zh-hans|zh-cn|zh',
    format: 'json',
    origin: '*',
  });
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
  for (const [id, entity] of Object.entries(payload?.entities ?? {})) {
    const labels = entity.labels ?? {};
    const label = labels['zh-hans']?.value ?? labels['zh-cn']?.value ?? labels.zh?.value ?? '';
    if (label) entityToZh.set(id, label);
  }
  await sleep(250);
}

for (const player of players) {
  const entity = titleToEntity.get(player.wikipedia_title);
  const label = entityToZh.get(entity);
  player.player_name_zh = label ?? '';
  player.player_name_zh_status = label ? 'wikidata_zh_label' : 'missing_zh_label';
}

writeCsv(playersPath, Object.keys(players[0]), players);
console.log(`Added verified Chinese labels for ${players.filter((p) => p.player_name_zh).length}/${players.length} players.`);
