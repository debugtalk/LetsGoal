/**
 * 开发调试方向失败归因分类器
 *
 * 规则优先的确定性分类器，读取 EvaluatorResult 输出，
 * 将失败归类为 9 类之一，规则无法覆盖时返回 "unknown"。
 *
 * 设计意图：零成本、确定性分类，作为 diagnose 阶段的子步骤。
 * 后续 M1+ 可在此基础上叠加 LLM 辅助分类。
 */

import type { EvaluationResult, HardGateResult } from "../../../core/scripts/types.js";
import type { EvaluatorResult } from "./types.js";

/** 9 类归因 + unknown 兜底 */
export type DiagnosisCategory =
  | "syntax_error"
  | "type_error"
  | "lint_violation"
  | "test_failure"
  | "integration_error"
  | "coverage_insufficient"
  | "architecture_mismatch"
  | "requirement_ambiguity"
  | "performance_regression"
  | "unknown";

export const CATEGORIES: DiagnosisCategory[] = [
  "syntax_error",
  "type_error",
  "lint_violation",
  "test_failure",
  "integration_error",
  "coverage_insufficient",
  "architecture_mismatch",
  "requirement_ambiguity",
  "performance_regression",
  "unknown",
];

/** 集成失败关键词 */
const INTEGRATION_KEYWORDS = ["ECONNREFUSED", "timeout", "fetch", "API"];

/** 语法错误关键词 */
const SYNTAX_KEYWORDS = ["SyntaxError", "Unexpected token"];

/** 类型错误关键词 */
const TYPE_KEYWORDS = ["Type", "is not assignable", "Property", "Argument of type"];

/** 判断某门禁是否失败 */
function isGateFailed(gate: string, hardGates: HardGateResult[]): boolean {
  return hardGates.some((g) => g.gate === gate && !g.passed);
}

/** 检查文本是否包含任一关键词（大小写敏感） */
function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

/**
 * 规则优先的失败分类。
 *
 * 优先级：syntax_error > type_error > lint_violation > integration_error > test_failure
 * 规则无法覆盖的返回 "unknown"。
 */
export function classifyFailure(
  evaluation: EvaluationResult,
  evaluatorResult?: EvaluatorResult,
): DiagnosisCategory {
  const hardGates = evaluation.hard_gates;
  const typecheckFailed = isGateFailed("typecheck", hardGates);
  const lintFailed = isGateFailed("lint", hardGates);
  const testFailed = isGateFailed("test", hardGates);

  // ---- 有 EvaluatorResult：用 stderr 精细分类 ----
  if (evaluatorResult !== undefined) {
    const tcStderr = evaluatorResult.typecheck?.stderr_tail ?? "";
    const testStderr = evaluatorResult.test?.stderr_tail ?? "";
    const testStdout = evaluatorResult.test?.stdout_tail ?? "";

    // 优先级 1: typecheck 失败 + 语法错误关键词
    if (typecheckFailed && containsAny(tcStderr, SYNTAX_KEYWORDS)) {
      return "syntax_error";
    }

    // 优先级 2: typecheck 失败 + 类型错误关键词
    if (typecheckFailed && containsAny(tcStderr, TYPE_KEYWORDS)) {
      return "type_error";
    }

    // 优先级 3: lint 失败 + 其他门禁通过
    if (lintFailed && !typecheckFailed && !testFailed) {
      return "lint_violation";
    }

    // 优先级 4: test 失败 + 外部依赖关键词
    if (testFailed) {
      const testOutput = testStderr + testStdout;
      if (containsAny(testOutput, INTEGRATION_KEYWORDS)) {
        return "integration_error";
      }
    }

    // 优先级 5: test 失败 + parsed_failures 有值
    if (
      testFailed &&
      evaluatorResult.test?.parsed_failures &&
      evaluatorResult.test.parsed_failures.length > 0
    ) {
      return "test_failure";
    }
  }

  // ---- 无 EvaluatorResult 或精细规则未命中：evaluation 级别分类 ----
  if (typecheckFailed) return "type_error";
  if (lintFailed && !typecheckFailed && !testFailed) return "lint_violation";
  if (testFailed) return "test_failure";

  return "unknown";
}
