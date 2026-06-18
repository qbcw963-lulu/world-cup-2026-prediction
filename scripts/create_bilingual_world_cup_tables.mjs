import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(path.dirname(scriptDir), 'data');

const teams = new Map([
  ['Mexico', '墨西哥'], ['South Africa', '南非'], ['South Korea', '韩国'],
  ['Czechia', '捷克'], ['Canada', '加拿大'],
  ['Bosnia and Herzegovina', '波斯尼亚和黑塞哥维那'], ['Qatar', '卡塔尔'],
  ['Switzerland', '瑞士'], ['Scotland', '苏格兰'], ['Brazil', '巴西'],
  ['Morocco', '摩洛哥'], ['Haiti', '海地'], ['United States', '美国'],
  ['Australia', '澳大利亚'], ['Türkiye', '土耳其'], ['Paraguay', '巴拉圭'],
  ['Germany', '德国'], ['Ivory Coast', '科特迪瓦'], ['Ecuador', '厄瓜多尔'],
  ['Curaçao', '库拉索'], ['Sweden', '瑞典'], ['Netherlands', '荷兰'],
  ['Japan', '日本'], ['Tunisia', '突尼斯'], ['Belgium', '比利时'],
  ['Egypt', '埃及'], ['Iran', '伊朗'], ['New Zealand', '新西兰'],
  ['Uruguay', '乌拉圭'], ['Saudi Arabia', '沙特阿拉伯'], ['Spain', '西班牙'],
  ['Cabo Verde', '佛得角'], ['Norway', '挪威'], ['France', '法国'],
  ['Senegal', '塞内加尔'], ['Iraq', '伊拉克'], ['Argentina', '阿根廷'],
  ['Austria', '奥地利'], ['Jordan', '约旦'], ['Algeria', '阿尔及利亚'],
  ['Portugal', '葡萄牙'], ['DR Congo', '刚果民主共和国'],
  ['Uzbekistan', '乌兹别克斯坦'], ['Colombia', '哥伦比亚'],
  ['England', '英格兰'], ['Ghana', '加纳'], ['Panama', '巴拿马'],
  ['Croatia', '克罗地亚'],
]);

const stages = new Map([
  ['Group stage', '小组赛'],
  ['Round of 32', '三十二强赛'],
  ['Round of 16', '十六强赛'],
  ['Quarterfinal', '四分之一决赛'],
  ['Semifinal', '半决赛'],
  ['Third-place match', '季军赛'],
  ['Final', '决赛'],
]);

const statuses = new Map([
  ['finished', '已结束 / Finished'],
  ['scheduled', '未开始 / Scheduled'],
  ['live_or_pending', '进行中或待确认 / Live or pending'],
]);

const venues = new Map([
  ['Estadio Azteca', '阿兹特克体育场'], ['Estadio Akron', '阿克伦体育场'],
  ['BMO Field', 'BMO球场'], ['SoFi Stadium', 'SoFi体育场'],
  ["Levi's Stadium", '李维斯体育场'], ['MetLife Stadium', '大都会人寿体育场'],
  ['Gillette Stadium', '吉列体育场'], ['BC Place', '卑诗体育馆'],
  ['NRG Stadium', 'NRG体育场'], ['AT&T Stadium', 'AT&T体育场'],
  ['Lincoln Financial Field', '林肯金融球场'], ['Estadio BBVA', 'BBVA体育场'],
  ['Mercedes-Benz Stadium', '梅赛德斯-奔驰体育场'], ['Lumen Field', '流明球场'],
  ['Hard Rock Stadium', '硬石体育场'], ['Arrowhead Stadium', '箭头体育场'],
]);

const cities = new Map([
  ['Mexico City', '墨西哥城'], ['Guadalajara', '瓜达拉哈拉'],
  ['Toronto', '多伦多'], ['Inglewood', '英格尔伍德'],
  ['Santa Clara', '圣克拉拉'], ['East Rutherford', '东卢瑟福'],
  ['Foxborough', '福克斯伯勒'], ['Vancouver', '温哥华'],
  ['Houston', '休斯敦'], ['Arlington', '阿灵顿'],
  ['Philadelphia', '费城'], ['Guadalupe', '瓜达卢佩'],
  ['Atlanta', '亚特兰大'], ['Seattle', '西雅图'],
  ['Miami Gardens', '迈阿密花园'], ['Kansas City', '堪萨斯城'],
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift();
  return rows.filter((values) => values.length === headers.length).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, headers, rows) {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  fs.writeFileSync(path.join(dataDir, fileName), `\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

function bilingual(map, value) {
  return map.has(value) ? `${map.get(value)} / ${value}` : value;
}

function participant(value) {
  if (teams.has(value)) return `${teams.get(value)} / ${value}`;
  let match = value.match(/^Winner Group ([A-L])$/);
  if (match) return `${match[1]}组第一名 / ${value}`;
  match = value.match(/^Runner-up Group ([A-L])$/);
  if (match) return `${match[1]}组第二名 / ${value}`;
  match = value.match(/^Best third Group (.+)$/);
  if (match) return `最佳小组第三名（${match[1]}） / ${value}`;
  match = value.match(/^Winner Match (\d+)$/);
  if (match) return `第${match[1]}场胜者 / ${value}`;
  match = value.match(/^Loser Match (\d+)$/);
  if (match) return `第${match[1]}场负者 / ${value}`;
  return value;
}

const schedule = parseCsv(fs.readFileSync(
  path.join(dataDir, 'world_cup_2026_schedule_104_matches.csv'), 'utf8'));
const scheduleHeaders = [
  '比赛编号 / Match ID', '比赛阶段 / Stage', '小组 / Group', '日期 / Date',
  '时间 / Time', '时区 / Time Zone', '主队 / Home', '客队 / Away',
  '主队进球 / Home Score', '客队进球 / Away Score', '比赛状态 / Status',
  '球场 / Venue', '城市 / City',
];
const bilingualSchedule = schedule.map((row) => ({
  '比赛编号 / Match ID': row.match_id,
  '比赛阶段 / Stage': bilingual(stages, row.stage),
  '小组 / Group': row.group ? `${row.group}组 / Group ${row.group}` : '',
  '日期 / Date': row.date,
  '时间 / Time': row.time,
  '时区 / Time Zone': row.time_zone === 'ET' ? '美国东部时间 / ET' : row.time_zone,
  '主队 / Home': participant(row.home),
  '客队 / Away': participant(row.away),
  '主队进球 / Home Score': row.home_score,
  '客队进球 / Away Score': row.away_score,
  '比赛状态 / Status': statuses.get(row.status) ?? row.status,
  '球场 / Venue': bilingual(venues, row.venue),
  '城市 / City': bilingual(cities, row.city),
}));
writeCsv('world_cup_2026_schedule_104_matches_中英双语.csv', scheduleHeaders, bilingualSchedule);

const standings = parseCsv(fs.readFileSync(
  path.join(dataDir, 'world_cup_2026_standings_2026-06-18.csv'), 'utf8'));
const standingsHeaders = [
  '数据日期 / Snapshot Date', '小组 / Group', '排名 / Rank', '球队 / Team',
  '场次 / Played', '胜 / Wins', '平 / Draws', '负 / Losses',
  '进球 / Goals For', '失球 / Goals Against', '净胜球 / Goal Difference',
  '积分 / Points',
];
const bilingualStandings = standings.map((row) => ({
  '数据日期 / Snapshot Date': row.snapshot_date,
  '小组 / Group': `${row.group}组 / Group ${row.group}`,
  '排名 / Rank': row.rank,
  '球队 / Team': participant(row.team),
  '场次 / Played': row.played,
  '胜 / Wins': row.wins,
  '平 / Draws': row.draws,
  '负 / Losses': row.losses,
  '进球 / Goals For': row.goals_for,
  '失球 / Goals Against': row.goals_against,
  '净胜球 / Goal Difference': row.goal_difference,
  '积分 / Points': row.points,
}));
writeCsv(
  'world_cup_2026_standings_2026-06-18_中英双语.csv',
  standingsHeaders,
  bilingualStandings,
);
