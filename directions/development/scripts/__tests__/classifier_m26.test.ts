import { describe, it, expect } from "vitest";
import { classifyFailure } from "../classifier.js";
import type { IterationResult } from "../../../../core/scripts/types.js";
import type { EvaluatorResult } from "../types.js";

import { makeEvaluation } from "./helpers.js";

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

function makeIterationResult(
  category?: string,
  overrides?: Partial<IterationResult>,
): IterationResult {
  return {
    iteration: 1,
    status: "failed",
    evaluation: makeEvaluation(["test"]),
    diagnosis: category ? { category, reason: "test" } : undefined,
    changed_files: ["src/foo.ts"],
    commit_sha: "abc123",
    next_action: "retry",
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// 规则 3: typecheck 含 circular/Circular dependency → architecture_mismatch
// ============================================================================

describe("classifyFailure — circular dependency → architecture_mismatch (M2.6)", () => {
  it("typecheck stderr contains 'circular' → architecture_mismatch", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail: "error TS2459: Module './a' has a circular dependency",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("architecture_mismatch");
  });

  it("typecheck stderr contains 'Circular dependency' → architecture_mismatch", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail: "Circular dependency detected between modules",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("architecture_mismatch");
  });

  it("circular rule takes precedence over type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail: "Circular dependency: Type 'string' is not assignable to type 'number'",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("architecture_mismatch");
  });
});

// ============================================================================
// 规则 4: typecheck 含 3+ "is not assignable" → architecture_mismatch
// ============================================================================

describe("classifyFailure — 3+ is not assignable → architecture_mismatch (M2.6)", () => {
  it("3 occurrences of 'is not assignable' → architecture_mismatch", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail:
          "Type 'string' is not assignable to type 'number'\n" +
          "Type 'boolean' is not assignable to type 'string'\n" +
          "Type 'null' is not assignable to type 'object'",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("architecture_mismatch");
  });

  it("2 occurrences of 'is not assignable' → type_error (not architecture_mismatch)", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail:
          "Type 'string' is not assignable to type 'number'\n" +
          "Type 'boolean' is not assignable to type 'string'",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });

  it("1 occurrence of 'is not assignable' → type_error", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail: "Type 'string' is not assignable to type 'number'",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });
});

// ============================================================================
// 规则 5: test 含 contradict/Conflict → requirement_ambiguity
// ============================================================================

describe("classifyFailure — contradict/Conflict → requirement_ambiguity (M2.6)", () => {
  it("test output contains 'contradict' → requirement_ambiguity", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult: EvaluatorResult = {
      test: makeRunResult({
        stderr_tail: "Error: test results contradict each other",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("requirement_ambiguity");
  });

  it("test output contains 'Conflict' → requirement_ambiguity", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult: EvaluatorResult = {
      test: makeRunResult({
        stdout_tail: "Conflict detected in test assertions",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("requirement_ambiguity");
  });

  it("contradict takes precedence over integration_error keywords", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult: EvaluatorResult = {
      test: makeRunResult({
        stderr_tail: "contradict: ECONNREFUSED",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("requirement_ambiguity");
  });
});

// ============================================================================
// 规则 1: 同 category 连续 3 次 → architecture_mismatch
// ============================================================================

describe("classifyFailure — consecutive 3 same category → architecture_mismatch (M2.6)", () => {
  it("3 consecutive type_error iterations → architecture_mismatch", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const history: IterationResult[] = [
      makeIterationResult("type_error", { iteration: 1 }),
      makeIterationResult("type_error", { iteration: 2 }),
      makeIterationResult("type_error", { iteration: 3 }),
    ];

    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("architecture_mismatch");
  });

  it("2 consecutive same category → not upgraded", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("test_failure", { iteration: 1 }),
      makeIterationResult("test_failure", { iteration: 2 }),
    ];

    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("test_failure");
  });

  it("non-consecutive same category → not upgraded by rule 1", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("lint_violation", { iteration: 1 }),
      makeIterationResult("test_failure", { iteration: 2 }),
      makeIterationResult("lint_violation", { iteration: 3 }),
    ];

    // Not 3 consecutive same → rule 1 doesn't apply; may still match rule 6
    const result = classifyFailure(evaluation, undefined, undefined, history);
    expect(result).toBe("test_failure");
  });
});

// ============================================================================
// 规则 2: 空 commit_sha + 无 changed_files → requirement_ambiguity
// ============================================================================

describe("classifyFailure — empty commit + no changes → requirement_ambiguity (M2.6)", () => {
  it("last history iteration with empty commit and no changes → requirement_ambiguity", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("test_failure", {
        iteration: 1,
        commit_sha: undefined,
        changed_files: [],
      }),
    ];

    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("requirement_ambiguity");
  });

  it("last history iteration with commit_sha → not requirement_ambiguity", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("test_failure", {
        iteration: 1,
        commit_sha: "abc123",
        changed_files: ["src/foo.ts"],
      }),
    ];

    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("test_failure");
  });

  it("last history iteration with changed files but no commit → not requirement_ambiguity", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("test_failure", {
        iteration: 1,
        commit_sha: undefined,
        changed_files: ["src/foo.ts"],
      }),
    ];

    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("test_failure");
  });
});

// ============================================================================
// 规则 6: 同 category 重复 3 次 → 升级 architecture_mismatch
// ============================================================================

describe("classifyFailure — repeated 3 times total → architecture_mismatch (M2.6)", () => {
  it("same category 3 times (non-consecutive) → architecture_mismatch", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("test_failure", { iteration: 1 }),
      makeIterationResult("lint_violation", { iteration: 2 }),
      makeIterationResult("test_failure", { iteration: 3 }),
      makeIterationResult("test_failure", { iteration: 4 }),
    ];

    // test_failure appears 3 times total → upgrade
    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("architecture_mismatch");
  });

  it("same category 2 times total → not upgraded by rule 6", () => {
    const evaluation = makeEvaluation(["test"]);
    const history: IterationResult[] = [
      makeIterationResult("test_failure", { iteration: 1 }),
      makeIterationResult("lint_violation", { iteration: 2 }),
      makeIterationResult("test_failure", { iteration: 3 }),
    ];

    expect(classifyFailure(evaluation, undefined, undefined, history)).toBe("test_failure");
  });
});

// ============================================================================
// Backward compatibility: no iterationHistory
// ============================================================================

describe("classifyFailure — backward compat without iterationHistory (M2.6)", () => {
  it("existing rules work without iterationHistory", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({ stderr_tail: "Type 'string' is not assignable to type 'number'" }),
    };

    expect(classifyFailure(evaluation, evaluatorResult)).toBe("type_error");
  });

  it("existing rules work with empty iterationHistory", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult: EvaluatorResult = {
      test: makeRunResult({ stderr_tail: "FAIL test" }),
    };

    expect(classifyFailure(evaluation, evaluatorResult, undefined, [])).toBe("test_failure");
  });

  it("existing priority: syntax_error > type_error still holds", () => {
    const evaluation = makeEvaluation(["typecheck"]);
    const evaluatorResult: EvaluatorResult = {
      typecheck: makeRunResult({
        stderr_tail: "SyntaxError: Unexpected token; Type 'x' is not assignable",
      }),
    };

    expect(classifyFailure(evaluation, evaluatorResult, undefined, [])).toBe("syntax_error");
  });
});
