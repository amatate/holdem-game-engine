import type { ArenaReport } from './runner.js';

export function renderArenaReport(report: ArenaReport): string {
  const number = (value: number | null) => value === null ? '—' : value.toFixed(2);
  const confidence = report.hero.confidence95;
  const metric = report.config.mode === 'cash'
    ? `${number(report.hero.bbPer100)} bb/100`
    : report.hero.winRate === null ? '未决 / unresolved' : `${(report.hero.winRate * 100).toFixed(1)}%`;
  return [
    '# 竞技 AI 本地评测 / Local poker arena', '',
    '**这是现有启发式策略的基线，不是增强后的 AI、GTO 或 Chipzen 参赛成绩。**', '',
    `- 模式 / Mode: ${report.config.mode}; ${report.agents.length} players; ${report.config.stackBB} BB`,
    `- Seed: ${JSON.stringify(report.config.seed)}`,
    `- 独立种子组 / Independent blocks: ${report.config.blocks}`,
    `- 对局 / Games: ${report.games}; 手牌 / Hands: ${report.hands}; 未决 / Censored: ${report.censoredGames}`,
    `- 主测牌手 / Hero: ${report.agents[0]!.id}`,
    `- 主测结果 / Estimate: ${metric}`,
    `- 95% CI (${report.hero.confidenceUnit}): ${confidence ? confidence.map(v => v.toFixed(3)).join(' … ') : '未提供 / withheld (see warnings)'}`,
    ...(report.hero.winRateBounds ? [`- 胜率上下界 / Win-fraction bounds: ${report.hero.winRateBounds.map(v => (v * 100).toFixed(1) + '%').join(' … ')}`] : []),
    `- 可重放结果摘要 / Result SHA-256: ${report.resultDigest}`, '',
    '| Entrant | Equity samples | Decisions | Invalid | Errors | Late/timeout | Fallbacks | p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.agents.map((a, i) => {
      const h = report.health[i]!;
      return `| ${i}: ${a.id} | ${a.equitySamples ?? '—'} | ${h.decisions} | ${h.invalid} | ${h.errors} | ${h.timeouts} | ${h.fallbacks} | ${number(report.latency[i]!.p95Ms)} |`;
    }), '',
    '## 边界 / Limitations', '', ...report.warnings.map(w => `- ${w}`), '',
  ].join('\n');
}
