/**
 * 开发调试方向失败归因
 *
 * 用硬门禁失败的 stderr_tail 摘要拼成自由文本 reason，
 * 同时调用 classifier 填充 Diagnosis.category。
 * 证据(stderr_tail)作为 Diagnosis.evidence 单独保留。
 */

import type { Diagnosis, EvaluationResult, IterationResult } from "../../../core/scripts/types.js";
import { DEV_GATE_NAMES, type DevTaskType } from "./types.js";
import type { EvaluatorResult, EvaluatorRunResult } from "./types.js";
import { classifyFailure, isDiagnosisCategory, CATEGORY_REPAIR_HINTS } from "./classifier.js";
import { appendCategoryLearning, appendAiLearning } from "../../../core/scripts/learnings.js";

/** stderr_tail 抽取的最大行数(作为 evidence) */
const EVIDENCE_LINES_PER_GATE = 8;

/** reason 中每个 gate 的 stderr_tail 取前几行 */
const REASON_STDERR_LINES = 2;

function extractFirstLines(text: string, n: number): string {
  if (text.length === 0) return "";
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(0, n).join(" | ");
}

/** 优先取 stderr，空时退回 stdout */
function pickOutput(r: EvaluatorRunResult): string {
  return r.stderr_tail.trim().length > 0 ? r.stderr_tail : r.stdout_tail;
}

function gateReason(gate: string, r?: EvaluatorRunResult): string | null {
  if (r === undefined) return `${gate}: 命令未发现(skip)但属于硬门禁`;
  if (r.passed) return null;
  const src = pickOutput(r);
  const head = extractFirstLines(src, REASON_STDERR_LINES);
  if (head.length === 0) {
    return `${gate}: exit_code=${r.exit_code} 无错误输出`;
  }
  return `${gate}: ${head}`;
}

function gateEvidence(gate: string, r?: EvaluatorRunResult): string[] {
  if (r === undefined || r.passed) return [];
  const src = pickOutput(r);
  if (src.length === 0) return [];
  const lines = src
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, EVIDENCE_LINES_PER_GATE);
  return lines.map((l) => `[${gate}] ${l}`);
}

function writeCategoryLearning(workspacePath: string | undefined, category: string | undefined): void {
  if (!workspacePath || !category || category === "unknown") return;
  if (!isDiagnosisCategory(category)) return;
  const hint = CATEGORY_REPAIR_HINTS[category];
  if (!hint) return;
  appendCategoryLearning(workspacePath, category, hint);
}

function writeAiLearning(workspacePath: string | undefined, aiLearnings: string | undefined): void {
  if (!workspacePath || !aiLearnings || aiLearnings.trim().length === 0) return;
  appendAiLearning(workspacePath, aiLearnings.trim());
}

export interface DiagnoseOptions {
  workspacePath?: string;
  aiLearnings?: string;
}

export function diagnoseDevelopmentFailure(
  evaluation: EvaluationResult,
  evaluatorResult?: EvaluatorResult,
  taskType?: DevTaskType,
  opts?: DiagnoseOptions,
  iterationHistory?: IterationResult[],
): Diagnosis {
  // 全过 → 不应进入这里,但保留兜底
  const failedGates = evaluation.hard_gates.filter((g) => !g.passed);
  if (failedGates.length === 0) {
    return { reason: "no failed hard gates" };
  }

  const reasonParts: string[] = [];
  const evidence: string[] = [];

  if (evaluatorResult !== undefined) {
    for (const g of DEV_GATE_NAMES) {
      const r = evaluatorResult[g];
      const reason = gateReason(g, r);
      if (reason !== null) reasonParts.push(reason);
      evidence.push(...gateEvidence(g, r));
    }
  } else {
    // 没有 EvaluatorResult,只能用 hard_gates.detail
    for (const g of failedGates) {
      reasonParts.push(`${g.gate}: ${g.detail ?? "failed"}`);
    }
  }

  // Coverage 门禁失败时补充覆盖率细节
  const coverageGate = failedGates.find((g) => g.gate === "coverage");
  if (coverageGate) {
    reasonParts.push(coverageGate.detail ?? "coverage gate failed");
    evidence.push(`[coverage] ${coverageGate.detail ?? "coverage gate failed"}`);
  }

  // coverage_insufficient 但硬门禁全通过 → 从软分提取覆盖率细节
  if (evaluation.soft_scores) {
    const coverageScore = evaluation.soft_scores.find((s) => s.name === "coverage");
    if (coverageScore && coverageScore.score < 1.0) {
      reasonParts.push(`coverage soft score: ${coverageScore.score.toFixed(2)} (weight=${coverageScore.weight})`);
    }
  }

  const category = classifyFailure(evaluation, evaluatorResult, taskType, iterationHistory);

  // M2.5: 经验沉淀写入
  writeCategoryLearning(opts?.workspacePath, category === "unknown" ? undefined : category);
  writeAiLearning(opts?.workspacePath, opts?.aiLearnings);

  return {
    category: category === "unknown" ? undefined : category,
    reason: reasonParts.join("; "),
    evidence: evidence.length > 0 ? evidence : undefined,
  };
}
