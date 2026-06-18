import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const players = readCsv(path.join(root, 'data', 'players_2026.csv'));
const teams = readCsv(path.join(root, 'data', 'teams_2026.csv'));
const staff = readCsv(path.join(root, 'data', 'team_staff_2026.csv'));
const referees = readCsv(path.join(root, 'data', 'referees_2026.csv'));
const contexts = readCsv(path.join(root, 'data', 'match_context_2026.csv'));
const odds = readCsv(path.join(root, 'data', 'market_odds_2026.csv'));

const count = (rows, predicate) => rows.filter(predicate).length;
const report = `# 数据完整度报告

生成时间：${new Date().toISOString()}

| 数据域 | 已获取 | 总量 | 状态 |
|---|---:|---:|---|
| 球队与主教练 | ${count(teams, (row) => row.head_coach)} | 48 | 完整 |
| 有公开助教/教练组记录的球队 | ${count(teams, (row) => row.assistant_coaches)} | 48 | 部分完成，需足协确认 |
| 教练组岗位记录 | ${staff.length} | 动态 | 已获取公开结构化记录 |
| 决赛名单球员 | ${players.length} | 1248 | 完整 |
| 有中文标签的球员 | ${count(players, (row) => row.player_name_zh)} | 1248 | Wikidata 可核验标签 |
| FIFA 任命主裁判 | ${referees.length} | 52 | 完整 |
| 已有比赛任命的裁判 | ${count(referees, (row) => row.matches_assigned)} | 52 | 随 FIFA 公布进度更新 |
| 小组赛上下文 | ${contexts.length} | 72 | 完整框架 |
| 已映射逐场裁判 | ${count(contexts, (row) => row.referee)} | 72 | 动态 |
| 已获取逐小时天气 | ${count(contexts, (row) => row.weather_status?.startsWith('open_meteo_'))} | 72 | 历史近况或预报窗口 |
| 市场赔率快照 | ${odds.length} | 动态 | DraftKings 官方公开开盘；多公司共识需授权 API |

## 不得伪造的缺口

- 未由足协或球队公开确认的助理教练不能标为“已核验”。
- 尚未公布的逐场裁判任命不能提前填写。
- 超出天气预报窗口的比赛不能填写伪精确天气。
- 单一博彩公司快照不能声称是多公司市场共识。
- 裁判执法习惯必须有足够历史样本；空白表示证据不足，不等于平均水平。
`;

fs.writeFileSync(path.join(root, 'outputs', 'data_quality_report_zh.md'), report, 'utf8');
console.log('Data quality report generated.');
