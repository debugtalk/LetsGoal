/**
 * 加权软分计算模块
 *
 * 从评估器输出中提取覆盖率，计算 4 维软分（coverage/complexity/smells/docs），
 * 并汇总为加权总分。complexity/smells/docs 在 M2 初期 stub 为 1.0。
 */

import type { EvaluatorResult } from "./types.js";
import type { SoftScoreItem } from "../../../core/scripts/types.js";

/** 默认软分权重 */
export const DEFAULT_SOFT_SCORE_WEIGHTS: Record<string, number> = {
  coverage: 0.4,
  complexity: 0.2,
  smells: 0.2,
  docs: 0.2,
};

/**
 * 从 vitest/jest 覆盖率输出中提取行覆盖率百分比（0-1）。
 *
 * 在 stdout 中查找 "All files" 行，提取 "% Lines" 列的数值，除以 100。
 * 找不到则返回 undefined。
 */
export function extractCoverageFromOutput(stdout: string): number | undefined {
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line.includes("All files")) continue;
    // 表格行格式: All files | <stmts> | <branch> | <funcs> | <lines> | ...
    // 按 | 分割，% Lines 是第 5 个字段（index 4）
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const raw = cells[4];
    const value = parseFloat(raw);
    if (Number.isNaN(value)) continue;
    return value / 100;
  }
  return undefined;
}

/**
 * 计算 4 维软分。complexity/smells/docs 在 M2 初期 stub 为 1.0。
 *
 * 覆盖率软分 = extracted / coverageTarget，上限 1.0。
 * 找不到覆盖率数据时默认 1.0。
 */
export function computeSoftScores(
  raw: EvaluatorResult,
  coverageTarget: number,
  precomputedCoverage?: number,
): SoftScoreItem[] {
  const extracted = precomputedCoverage ?? extractCoverageFromOutput(raw.test?.stdout_tail ?? "");
  const coverageScore = extracted === undefined
    ? 1.0
    : Math.min(extracted / coverageTarget, 1.0);

  return [
    { name: "coverage", score: coverageScore, weight: DEFAULT_SOFT_SCORE_WEIGHTS.coverage },
    { name: "complexity", score: 1.0, weight: DEFAULT_SOFT_SCORE_WEIGHTS.complexity },
    { name: "smells", score: 1.0, weight: DEFAULT_SOFT_SCORE_WEIGHTS.smells },
    { name: "docs", score: 1.0, weight: DEFAULT_SOFT_SCORE_WEIGHTS.docs },
  ];
}

/**
 * 计算加权总分：sum(score * weight)。
 */
export function computeWeightedScore(items: SoftScoreItem[]): number {
  return items.reduce((sum, item) => sum + item.score * item.weight, 0);
}
