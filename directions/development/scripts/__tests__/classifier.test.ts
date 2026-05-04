import { describe, it, expect } from "vitest";
import { classifyFailure, CATEGORIES } from "../classifier.js";
import type { DiagnosisCategory } from "../classifier.js";
import type { EvaluationResult } from "../../../../core/scripts/types.js";
import type { EvaluatorResult } from "../types.js";

// ============================================================================
// 测试辅助
// ============================================================================

function makeEvaluation(failedGates: string[]): EvaluationResult {
  return {
    hard_gates: failedGates.map((g) => ({
      gate: g,
      passed: false,
      detail: `${g} failed`,
    })),
    hard_gates_all_passed: failedGates.length === 0,
    weighted_score: 0,
  };
}

function makeAllPassedEvaluation(): EvaluationResult {
  return {
    hard_gates: [
      { gate: "lint", passed: true },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: true },
    ],
    hard_gates_all_passed: true,
    weighted_score: 1.0,
  };
}

function makeEvaluatorResult(
  overrides: Partial<EvaluatorResult>,
): EvaluatorResult {
  return { ...overrides };
}

function makeRunResult(overrides: Partial<{
  exit_code: number;
  passed: boolean;
  stderr_tail: string;
  stdout_tail: string;
  parsed_failures: string[];
}> = {}): NonNullable<EvaluatorResult["lint"]> {
  return {
    command: "test-cmd",
    exit_code: overrides.exit_code ?? 1,
    passed: overrides.passed ?? false,
    duration_ms: 100,
    stdout_tail: overrides.stdout_tail ?? "",
    stderr_tail: overrides.stderr_tail ?? "",
    parsed_failures: overrides.parsed_failures,
  };
}

// ============================================================================
// 测试
// ============================================================================

describe("CATEGORIES 常量", () => {
  it("应包含 10 个分类（9 类 + unknown）", () => {
    expect(CATEGORIES).toHaveLength(10);
    expect(CATEGORIES).toContain("unknown");
  });
});

describe("classifyFailure — syntax_error", () => {
  it("typecheck 失败 + stderr 含 SyntaxError → syntax_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "SyntaxError: Unexpected token" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("syntax_error");
  });

  it("typecheck 失败 + stderr 含 Unexpected token → syntax_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "Error: Unexpected token '{'" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("syntax_error");
  });
});

describe("classifyFailure — type_error", () => {
  it("typecheck 失败 + stderr 含 'is not assignable' → type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "Type 'string' is not assignable to type 'number'" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });

  it("typecheck 失败 + stderr 含 'Property' → type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "Property 'foo' does not exist on type 'Bar'" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });

  it("typecheck 失败 + stderr 含 'Argument of type' → type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "Argument of type 'string' is not assignable" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });

  it("typecheck 失败 + stderr 含 'Type' → type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "Type 'number' is not assignable to type 'string'" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });
});

describe("classifyFailure — lint_violation", () => {
  it("lint 失败 + 其他门禁通过 → lint_violation", () => {
    const evaluation: EvaluationResult = {
      hard_gates: [
        { gate: "lint", passed: false, detail: "lint failed" },
        { gate: "typecheck", passed: true },
        { gate: "test", passed: true },
      ],
      hard_gates_all_passed: false,
      weighted_score: 0,
    };
    const evaluatorResult = makeEvaluatorResult({
      lint: makeRunResult({ stderr_tail: "2 problems (2 errors, 0 warnings)" }),
      typecheck: makeRunResult({ passed: true, exit_code: 0 }),
      test: makeRunResult({ passed: true, exit_code: 0 }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("lint_violation");
  });

  it("lint 失败 + typecheck 也失败 → 不是 lint_violation", () => {
    const evaluation = makeEvaluation(["lint", "typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      lint: makeRunResult({ stderr_tail: "lint error" }),
      typecheck: makeRunResult({ stderr_tail: "Type error" }),
    });

    const result = classifyFailure(evaluation, evaluatorResult);
    expect(result).not.toBe("lint_violation");
  });
});

describe("classifyFailure — integration_error", () => {
  it("test 失败 + stderr 含 ECONNREFUSED → integration_error", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({ stderr_tail: "Error: connect ECONNREFUSED 127.0.0.1:5432" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("integration_error");
  });

  it("test 失败 + stderr 含 timeout → integration_error", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({ stderr_tail: "Error: timeout of 5000ms exceeded" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("integration_error");
  });

  it("test 失败 + stdout 含 fetch → integration_error", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({
        stderr_tail: "",
        stdout_tail: "TypeError: fetch failed",
      }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("integration_error");
  });

  it("test 失败 + stdout 含 API → integration_error", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({
        stderr_tail: "",
        stdout_tail: "API returned 500",
      }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("integration_error");
  });
});

describe("classifyFailure — test_failure", () => {
  it("test 失败 + parsed_failures 有值 → test_failure", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({
        stderr_tail: "FAIL test/fizzbuzz.test.ts",
        parsed_failures: ["divisible by 15"],
      }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("test_failure");
  });

  it("test 失败 + 无集成关键词 + 无 parsed_failures → 回退为 test_failure（evaluation 级别）", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({ stderr_tail: "some generic test error" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("test_failure");
  });
});

describe("classifyFailure — 多规则优先级", () => {
  it("syntax_error 优先于 type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({
        stderr_tail: "SyntaxError: Unexpected token; Type 'x' is not assignable",
      }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("syntax_error");
  });

  it("syntax_error 优先于 lint_violation（typecheck+lint 同时失败）", () => {
    const evaluation: EvaluationResult = {
      hard_gates: [
        { gate: "typecheck", passed: false, detail: "failed" },
        { gate: "lint", passed: false, detail: "failed" },
      ],
      hard_gates_all_passed: false,
      weighted_score: 0,
    };
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "SyntaxError: Unexpected token" }),
      lint: makeRunResult({ stderr_tail: "lint error" }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("syntax_error");
  });

  it("integration_error 优先于 test_failure", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({
      test: makeRunResult({
        stderr_tail: "ECONNREFUSED",
        parsed_failures: ["some test"],
      }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("integration_error");
  });
});

describe("classifyFailure — 全部通过", () => {
  it("所有门禁通过 → unknown", () => {
    const evaluation = makeAllPassedEvaluation();

    expect(classifyFailure(evaluation)).toBe("unknown");
  });

  it("所有门禁通过 + 有 evaluatorResult → unknown", () => {
    const evaluation = makeAllPassedEvaluation();
    const evaluatorResult = makeEvaluatorResult({
      lint: makeRunResult({ passed: true, exit_code: 0 }),
      typecheck: makeRunResult({ passed: true, exit_code: 0 }),
      test: makeRunResult({ passed: true, exit_code: 0 }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("unknown");
  });
});

describe("classifyFailure — 无 evaluatorResult 回退", () => {
  it("无 evaluatorResult + typecheck 失败 → type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);

    expect(classifyFailure(evaluation)).toBe("type_error");
  });

  it("无 evaluatorResult + lint 失败（其他通过）→ lint_violation", () => {
    const evaluation: EvaluationResult = {
      hard_gates: [
        { gate: "lint", passed: false, detail: "failed" },
        { gate: "typecheck", passed: true },
        { gate: "test", passed: true },
      ],
      hard_gates_all_passed: false,
      weighted_score: 0,
    };

    expect(classifyFailure(evaluation)).toBe("lint_violation");
  });

  it("无 evaluatorResult + test 失败 → test_failure", () => {
    const evaluation = makeEvaluation(["test"]);

    expect(classifyFailure(evaluation)).toBe("test_failure");
  });

  it("无 evaluatorResult + 多门禁失败 → 按优先级取第一个", () => {
    const evaluation = makeEvaluation(["test", "typecheck"]);

    // typecheck 优先
    expect(classifyFailure(evaluation)).toBe("type_error");
  });
});

describe("classifyFailure — coverage_insufficient", () => {
  it("所有硬门禁通过 + weighted_score < 1.0 → coverage_insufficient", () => {
    const evaluation: EvaluationResult = {
      hard_gates: [
        { gate: "lint", passed: true },
        { gate: "typecheck", passed: true },
        { gate: "test", passed: true },
      ],
      hard_gates_all_passed: true,
      weighted_score: 0.6,
    };

    expect(classifyFailure(evaluation)).toBe("coverage_insufficient");
  });

  it("所有硬门禁通过 + weighted_score < 1.0 + 有 evaluatorResult → coverage_insufficient", () => {
    const evaluation: EvaluationResult = {
      hard_gates: [
        { gate: "lint", passed: true },
        { gate: "typecheck", passed: true },
        { gate: "test", passed: true },
      ],
      hard_gates_all_passed: true,
      weighted_score: 0.45,
    };
    const evaluatorResult = makeEvaluatorResult({
      lint: makeRunResult({ passed: true, exit_code: 0 }),
      typecheck: makeRunResult({ passed: true, exit_code: 0 }),
      test: makeRunResult({ passed: true, exit_code: 0 }),
    });

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("coverage_insufficient");
  });

  it("所有硬门禁通过 + weighted_score = 1.0 → unknown（不是 coverage_insufficient）", () => {
    const evaluation = makeAllPassedEvaluation();

    expect(classifyFailure(evaluation)).toBe("unknown");
  });

  it("有硬门禁失败 + weighted_score < 1.0 → 不是 coverage_insufficient", () => {
    const evaluation = makeEvaluation(["test"]);

    expect(classifyFailure(evaluation)).toBe("test_failure");
  });
});

describe("classifyFailure — 规则未覆盖的分类返回 unknown", () => {
  it("typecheck 失败但 stderr 不匹配任何已知模式 → 回退 evaluation 级别", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult = makeEvaluatorResult({
      typecheck: makeRunResult({ stderr_tail: "generic build error" }),
    });

    // 精细规则未命中 → 回退到 evaluation 级别 → type_error
    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });
});

describe("DiagnosisCategory 类型", () => {
  it("所有 10 个分类都在 CATEGORIES 中", () => {
    const expected: DiagnosisCategory[] = [
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
    for (const cat of expected) {
      expect(CATEGORIES).toContain(cat);
    }
  });
});
