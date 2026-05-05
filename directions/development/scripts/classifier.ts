/**
 * 开发调试方向失败归因分类器
 *
 * 规则优先的确定性分类器，读取 EvaluatorResult 输出，
 * 将失败归类为 9 类之一，规则无法覆盖时返回 "unknown"。
 *
 * M2.6 新增 6 条规则（跨迭代模式、Claude 放弃、循环依赖、需求矛盾等）。
 */

import type { EvaluationResult, IterationResult } from "../../../core/scripts/types.js";
import type { EvaluatorResult, DevTaskType } from "./types.js";

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

const TYPE_KEYWORDS = ["is not assignable", "Property '", "Argument of type", "Type '", "is missing the following properties", "Cannot find module"];

/** 需求矛盾关键词（M2.6） */
const CONTRADICTION_KEYWORDS = ["contradict", "Conflict"];

// ============================================================================
// 分类逻辑
// ============================================================================

function containsAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

/** 统计文本中 pattern 出现的次数 */
function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(pattern, idx)) !== -1) {
    count++;
    idx += pattern.length;
  }
  return count;
}

/**
 * 判断迭代历史中同 category 是否连续出现 N 次。
 */
function isConsecutiveCategory(history: IterationResult[], category: string, n: number): boolean {
  if (history.length < n) return false;
  const lastN = history.slice(-n);
  return lastN.every((iter) => iter.diagnosis?.category === category);
}

/**
 * 判断迭代历史中同 category 是否累计出现 N 次。
 */
function isRepeatedCategory(history: IterationResult[], category: string, n: number): boolean {
  const count = history.filter((iter) => iter.diagnosis?.category === category).length;
  return count >= n;
}

/**
 * 门禁规则分类（不包含历史规则）。
 * 保持原有优先级：syntax_error > type_error > lint_violation > integration_error > test_failure
 */
function classifyByGates(
  evaluation: EvaluationResult,
  evaluatorResult?: EvaluatorResult,
  taskType?: DevTaskType,
): DiagnosisCategory {
  const failedGateNames = new Set(
    evaluation.hard_gates.filter((g) => !g.passed).map((g) => g.gate),
  );
  const typecheckFailed = failedGateNames.has("typecheck");
  const lintFailed = failedGateNames.has("lint");
  const testFailed = failedGateNames.has("test");

  // typecheck 失败：用 stderr 精细区分 syntax_error / type_error / architecture_mismatch
  if (typecheckFailed) {
    if (evaluatorResult !== undefined) {
      const tcStderr = evaluatorResult.typecheck?.stderr_tail ?? "";

      // M2.6: circular dependency → architecture_mismatch（优先于 syntax/type 关键词）
      if (tcStderr.includes("circular") || tcStderr.includes("Circular dependency")) {
        return "architecture_mismatch";
      }

      // M2.6: 3+ "is not assignable" → architecture_mismatch
      if (countOccurrences(tcStderr, "is not assignable") >= 3) {
        return "architecture_mismatch";
      }

      if (containsAny(tcStderr, SYNTAX_KEYWORDS)) return "syntax_error";
      if (containsAny(tcStderr, TYPE_KEYWORDS)) return "type_error";
    }
    return "type_error";
  }

  // lint 失败 + 其他门禁通过
  if (lintFailed && !testFailed) return "lint_violation";

  // test 失败：用 stderr/stdout 区分 requirement_ambiguity / integration_error / test_failure
  if (testFailed) {
    if (evaluatorResult !== undefined) {
      const testOutput =
        (evaluatorResult.test?.stderr_tail ?? "") + (evaluatorResult.test?.stdout_tail ?? "");

      // M2.6: contradict/Conflict → requirement_ambiguity
      if (containsAny(testOutput, CONTRADICTION_KEYWORDS)) return "requirement_ambiguity";

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

  // Refactor 场景：测试失败意味着重构破坏了行为 → 触发升级
  if (taskType === "refactor" && testFailed) {
    return "architecture_mismatch";
  }

  return "unknown";
}

/**
 * 规则优先的失败分类。
 *
 * 优先级：syntax_error > type_error > lint_violation > integration_error > test_failure
 * 规则无法覆盖的返回 "unknown"。
 *
 * M2.6 新增规则（不改变已有分类规则优先级，作为后处理增强和兜底）：
 * - typecheck 含 circular/Circular dependency → architecture_mismatch
 * - typecheck 含 3+ "is not assignable" → architecture_mismatch
 * - test 含 contradict/Conflict → requirement_ambiguity
 * - 历史：同 category 连续 3 次 → architecture_mismatch
 * - 历史：空 commit_sha + 无 changed_files → requirement_ambiguity
 * - 兜底：同 category 重复 3 次 → 升级为 architecture_mismatch
 */
export function classifyFailure(
  evaluation: EvaluationResult,
  evaluatorResult?: EvaluatorResult,
  taskType?: DevTaskType,
  iterationHistory?: IterationResult[],
): DiagnosisCategory {
  // Phase 1: 门禁规则分类（保持原有优先级不变）
  let category = classifyByGates(evaluation, evaluatorResult, taskType);

  // Phase 2: 基于迭代历史的后处理规则（M2.6）
  if (iterationHistory !== undefined && iterationHistory.length > 0) {
    // 规则: 同 category 连续 3 次 → architecture_mismatch
    const lastCategory = iterationHistory[iterationHistory.length - 1]?.diagnosis?.category;
    if (lastCategory && isConsecutiveCategory(iterationHistory, lastCategory, 3)) {
      return "architecture_mismatch";
    }

    // 规则: 空 commit_sha + 无 changed_files（Claude 放弃）→ requirement_ambiguity
    const lastIter = iterationHistory[iterationHistory.length - 1];
    if (lastIter && !lastIter.commit_sha && lastIter.changed_files.length === 0) {
      return "requirement_ambiguity";
    }

    // 兜底: 同 category 重复 3 次 → 升级为 architecture_mismatch
    if (lastCategory && isRepeatedCategory(iterationHistory, lastCategory, 3)) {
      return "architecture_mismatch";
    }
  }

  return category;
}
