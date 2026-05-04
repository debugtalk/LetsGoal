/**
 * 开发调试方向失败归因
 *
 * 用硬门禁失败的 stderr_tail 摘要拼成自由文本 reason，
 * 同时调用 classifier 填充 Diagnosis.category。
 * 证据(stderr_tail)作为 Diagnosis.evidence 单独保留。
 */

import type { Diagnosis, EvaluationResult } from "../../../core/scripts/types.js";
import { DEV_GATE_NAMES } from "./types.js";
import type { EvaluatorResult, EvaluatorRunResult } from "./types.js";
import { classifyFailure } from "./classifier.js";

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

/**
 * 从 EvaluationResult(共享类型)+ EvaluatorResult(方向特异)拼出 Diagnosis。
 *
 * 优先用 EvaluatorResult 的 stderr_tail 给出有用的细节;EvaluatorResult 缺失时
 * 退回 evaluation.hard_gates[*].detail。
 */
export function diagnoseDevelopmentFailure(
  evaluation: EvaluationResult,
  evaluatorResult?: EvaluatorResult,
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

  const category = classifyFailure(evaluation, evaluatorResult);

  return {
    category: category === "unknown" ? undefined : category,
    reason: reasonParts.join("; "),
    evidence: evidence.length > 0 ? evidence : undefined,
  };
}
