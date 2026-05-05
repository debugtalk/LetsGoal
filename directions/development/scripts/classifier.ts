/**
 * 开发调试方向失败归因分类器
 *
 * 规则优先的确定性分类器，读取 EvaluatorResult 输出，
 * 将失败归类为 9 类之一，规则无法覆盖时返回 "unknown"。
 */

import type { EvaluationResult } from "../../../core/scripts/types.js";
import type { EvaluatorResult } from "./types.js";

// ============================================================================
// 分类定义（唯一来源，类型从值推导）
// ============================================================================

export const CATEGORIES = [
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
] as const;

export type DiagnosisCategory = typeof CATEGORIES[number];

/** 需要升级人工的归因分类 */
export const ESCALATE_CATEGORIES: ReadonlySet<DiagnosisCategory> = new Set([
  "architecture_mismatch",
  "requirement_ambiguity",
]);

/** 归因分类 → 修复策略提示 */
export const CATEGORY_REPAIR_HINTS: Partial<Record<DiagnosisCategory, string>> = {
  syntax_error: "语法错误，直接定位报错位置修复",
  type_error: "类型错误，根据类型信息修复类型标注或代码逻辑",
  lint_violation: "lint 报错，按 lint 规则修复代码风格或结构问题",
  test_failure: "测试失败，定位具体失败用例，分析原因并修复对应代码",
  integration_error: "集成失败，检查外部依赖连接/IO/API 调用，考虑添加重试或降级",
  architecture_mismatch: "设计违反约束，可能需要人工介入——不要强行绕过约束",
  requirement_ambiguity: "需求不明确，不要猜测意图——明确需求后再修复",
  performance_regression: "性能退化，排查最近的变更是否引入性能瓶颈",
  coverage_insufficient: "覆盖率不达标，补充缺失的测试用例",
};

/** 类型守卫：判断字符串是否为合法 DiagnosisCategory */
export function isDiagnosisCategory(value: string): value is DiagnosisCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

// ============================================================================
// 规则匹配关键词
// ============================================================================

const INTEGRATION_KEYWORDS = ["ECONNREFUSED", "timeout", "fetch", "API"];

const SYNTAX_KEYWORDS = ["SyntaxError", "Unexpected token"];

const TYPE_KEYWORDS = ["is not assignable", "Property '", "Argument of type", "Type '"];

// ============================================================================
// 分类逻辑
// ============================================================================

function containsAny(text: string, patterns: readonly string[]): boolean {
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
  const failedGateNames = new Set(
    evaluation.hard_gates.filter((g) => !g.passed).map((g) => g.gate),
  );
  const typecheckFailed = failedGateNames.has("typecheck");
  const lintFailed = failedGateNames.has("lint");
  const testFailed = failedGateNames.has("test");

  // typecheck 失败：用 stderr 精细区分 syntax_error / type_error
  if (typecheckFailed) {
    if (evaluatorResult !== undefined) {
      const tcStderr = evaluatorResult.typecheck?.stderr_tail ?? "";
      if (containsAny(tcStderr, SYNTAX_KEYWORDS)) return "syntax_error";
      if (containsAny(tcStderr, TYPE_KEYWORDS)) return "type_error";
    }
    return "type_error";
  }

  // lint 失败 + 其他门禁通过
  if (lintFailed && !testFailed) return "lint_violation";

  // test 失败：用 stderr/stdout 区分 integration_error / test_failure
  if (testFailed) {
    if (evaluatorResult !== undefined) {
      const testOutput =
        (evaluatorResult.test?.stderr_tail ?? "") + (evaluatorResult.test?.stdout_tail ?? "");
      if (containsAny(testOutput, INTEGRATION_KEYWORDS)) return "integration_error";
      if (
        evaluatorResult.test?.parsed_failures &&
        evaluatorResult.test.parsed_failures.length > 0
      ) {
        return "test_failure";
      }
    }
    return "test_failure";
  }

  // 所有硬门禁通过但加权分不足 → 覆盖率不足
  if (evaluation.hard_gates_all_passed && evaluation.weighted_score < 1.0) {
    return "coverage_insufficient";
  }

  // Coverage 硬门禁失败（actual < target）
  if (failedGateNames.has("coverage")) {
    return "coverage_insufficient";
  }

  return "unknown";
}
