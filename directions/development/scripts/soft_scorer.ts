/**
 * 加权软分计算模块
 *
 * 从评估器输出中提取覆盖率，计算 4 维软分（coverage/complexity/smells/docs），
 * 并汇总为加权总分。M4 实现 smells/complexity/docs 真实计算。
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

/** smells 维度：lint warnings 上限，超过则扣分 */
const MAX_LINT_WARNINGS = 20;

/** complexity 维度：changed files 启发式基线 */
const COMPLEXITY_BASELINE = 10;

/** docs 维度：无文档变更时的默认分 */
const DOCS_NO_DOC_SCORE = 0.7;

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
 * 从 lint 输出中提取 warnings 数量。
 *
 * 匹配格式：`N problems (E errors, W warnings)`
 * 也支持：`N problems (E errors, W warnings, ...)`（eslint 多段格式）
 */
export function extractLintWarnings(output: string): number | undefined {
  const match = output.match(/(\d+)\s+problems\s*\([^)]*?(\d+)\s+warnings/);
  if (match === null) return undefined;
  return parseInt(match[2], 10);
}

/**
 * 从 eslint 输出中提取 complexity 警告的最高复杂度值。
 *
 * 匹配格式：`max-lines` / `complexity` 规则输出中的数字。
 * 找不到返回 undefined。
 */
export function extractComplexityFromEslint(output: string): number | undefined {
  const matches = output.match(/complexity\s+\((\d+)\)/g);
  if (matches === null || matches.length === 0) return undefined;
  let maxComplexity = 0;
  for (const m of matches) {
    const num = parseInt(m.match(/(\d+)/)?.[1] ?? "0", 10);
    if (num > maxComplexity) maxComplexity = num;
  }
  return maxComplexity > 0 ? maxComplexity : undefined;
}

/**
 * 计算 smells 维度软分。
 *
 * 从 lint 输出中解析 warnings 数量：
 * `score = max(0, 1 - warnings / MAX_LINT_WARNINGS)`
 * 无 lint 输出时默认 1.0。
 */
function computeSmellsScore(raw: EvaluatorResult): number {
  const stdout = raw.lint?.stdout_tail ?? "";
  const stderr = raw.lint?.stderr_tail ?? "";
  const lintOutput = stdout.length > 0 ? stdout : stderr;
  if (lintOutput.length === 0) return 1.0;
  const warnings = extractLintWarnings(lintOutput);
  if (warnings === undefined) return 1.0;
  return Math.max(0, 1 - warnings / MAX_LINT_WARNINGS);
}

/**
 * 计算 complexity 维度软分。
 *
 * 优先解析 eslint complexity 规则输出；
 * 回退到 changed files 数量启发式 `score = max(0, 1 - changedFiles / COMPLEXITY_BASELINE)`。
 * 无数据时默认 1.0。
 */
function computeComplexityScore(raw: EvaluatorResult, changedFiles?: string[]): number {
  const stdout = raw.lint?.stdout_tail ?? "";
  const stderr = raw.lint?.stderr_tail ?? "";
  const lintOutput = stdout.length > 0 ? stdout : stderr;
  const complexity = extractComplexityFromEslint(lintOutput);
  if (complexity !== undefined) {
    return Math.max(0, 1 - complexity / 20);
  }
  if (changedFiles !== undefined && changedFiles.length > 0) {
    return Math.max(0, 1 - changedFiles.length / COMPLEXITY_BASELINE);
  }
  return 1.0;
}

/**
 * 计算 docs 维度软分。
 *
 * changed files 包含 README/CHANGELOG/.md → 1.0，否则 → DOCS_NO_DOC_SCORE (0.7)。
 * 无 changedFiles 时默认 1.0。
 */
function computeDocsScore(changedFiles?: string[]): number {
  if (changedFiles === undefined || changedFiles.length === 0) return 1.0;
  const hasDoc = changedFiles.some((f) => {
    const lower = f.toLowerCase();
    return lower.endsWith(".md") || lower.includes("readme") || lower.includes("changelog");
  });
  return hasDoc ? 1.0 : DOCS_NO_DOC_SCORE;
}

/**
 * 计算 4 维软分。
 *
 * 覆盖率软分 = extracted / coverageTarget，上限 1.0。
 * 找不到覆盖率数据时默认 1.0。
 * smells/complexity/docs 在 M4 实现真实计算。
 */
export function computeSoftScores(
  raw: EvaluatorResult,
  coverageTarget: number,
  precomputedCoverage?: number,
  changedFiles?: string[],
): SoftScoreItem[] {
  const extracted = precomputedCoverage ?? extractCoverageFromOutput(raw.test?.stdout_tail ?? "");
  const coverageScore = extracted === undefined
    ? 1.0
    : Math.min(extracted / coverageTarget, 1.0);

  return [
    { name: "coverage", score: coverageScore, weight: DEFAULT_SOFT_SCORE_WEIGHTS.coverage },
    { name: "complexity", score: computeComplexityScore(raw, changedFiles), weight: DEFAULT_SOFT_SCORE_WEIGHTS.complexity },
    { name: "smells", score: computeSmellsScore(raw), weight: DEFAULT_SOFT_SCORE_WEIGHTS.smells },
    { name: "docs", score: computeDocsScore(changedFiles), weight: DEFAULT_SOFT_SCORE_WEIGHTS.docs },
  ];
}

/**
 * 计算加权总分：sum(score * weight)。
 */
export function computeWeightedScore(items: SoftScoreItem[]): number {
  return items.reduce((sum, item) => sum + item.score * item.weight, 0);
}
