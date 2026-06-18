# 2026 世界杯预测模型

这是一个可持续更新的 2026 FIFA 世界杯数据与概率预测项目。

## 已纳入的数据

- 104 场完整赛程、实时赛果与 12 组积分。
- 48 队 2026 年 6 月 FIFA 排名、主教练与教练组。
- 1248 名决赛名单球员、号码、位置、生日、俱乐部、国家队出场与进球。
- 52 名 FIFA 任命主裁判、助理裁判搭档与已公布比赛任命。
- 本届赛事裁判牌数样本。
- 球场经纬度、海拔、屋顶类型、旅行距离和休息时间。
- 72 场小组赛逐小时天气。
- 已知伤停、停赛和需监测的球员状态。
- 胜平负、正确比分、模型让球胜平负和半全场预测。

## 主要输出

- `outputs/predictions_latest.csv`：机器可读预测。
- `outputs/prediction_report_zh.md`：中文综合预测报告。
- `outputs/completed_match_upset_analysis.csv`：已完赛爆冷分析。
- `outputs/data_quality_report_zh.md`：数据完整度与剩余缺口。

## 更新数据

```powershell
npm run refresh:matchday
```

完整刷新球队、球员与教练组：

```powershell
npm run fetch:squads
npm run fetch:player-zh
npm run fetch:staff
npm run fetch:rankings
```

## 赔率

赔率必须保存博彩公司、抓取时间和来源。项目不会伪造赔率。配置授权密钥后：

```powershell
$env:THE_ODDS_API_KEY="your-key"
npm run fetch:odds
```

## 模型限制

- 让球线是模型生成线，并非中国体育彩票官方让球线。
- 未公布的裁判、首发、伤停和远期天气会明确标为待更新。
- 概率预测不保证命中，也不构成投注建议。
