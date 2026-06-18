import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const predictions = readCsv(path.join(root, 'outputs', 'predictions_latest.csv'));
const generatedAt = predictions[0]?.generated_at ?? new Date().toISOString();

const lines = [
  '# 2026 世界杯后续赛事综合预测',
  '',
  `生成时间：${generatedAt}`,
  '',
  '> 概率模型不是确定答案；让球线为模型生成线，并非中国体育彩票官方让球线。',
  '',
  '| 场次 | 比赛 | 胜/平/负概率 | 比分 | 让球预测 | 半全场 | 数据完整度 |',
  '|---:|---|---|---|---|---|---:|',
];

for (const row of predictions) {
  const handicapDisplay = Number(row.home_handicap_line) > 0
    ? `+${row.home_handicap_line}`
    : row.home_handicap_line;
  lines.push(
    `| ${row.match_id} | ${row.home}—${row.away} | ` +
    `${row.home_win_pct}% / ${row.draw_pct}% / ${row.away_win_pct}% | ` +
    `${row.predicted_score} | 主队${handicapDisplay}：${row.predicted_handicap_zh} | ` +
    `${row.predicted_half_full_zh} | ${row.data_completeness_pct}% |`,
  );
}

lines.push('', '## 逐场主要因素', '');
for (const row of predictions) {
  lines.push(
    `### 第${row.match_id}场 ${row.home}—${row.away}`,
    '',
    `- 结论：${row.predicted_1x2_zh}，参考比分 ${row.predicted_score}。`,
    `- 主要因素：${row.key_factors}`,
    `- 限制：${row.limitations}`,
    '',
  );
}

fs.writeFileSync(
  path.join(root, 'outputs', 'prediction_report_zh.md'),
  `${lines.join('\n')}\n`,
  'utf8',
);
console.log(`Prediction report generated for ${predictions.length} matches.`);
