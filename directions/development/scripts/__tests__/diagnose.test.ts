import { describe, it, expect } from "vitest";
import { diagnoseDevelopmentFailure } from "../diagnose.js";
import type { EvaluationResult } from "../../../../core/scripts/types.js";
import type { EvaluatorResult } from "../types.js";

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

function makeEvaluatorResult(
  overrides: Partial<EvaluatorResult> & { failed?: string[] },
): EvaluatorResult {
  const result: EvaluatorResult = {};
  const failed = overrides.failed ?? [];
  for (const gate of ["lint", "typecheck", "test"] as const) {
    if (overrides[gate] !== undefined) {
      result[gate] = overrides[gate];
    } else if (failed.includes(gate)) {
      result[gate] = {
        command: `cmd-${gate}`,
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "",
        stderr_tail: `${gate} error: something went wrong\nline 2 of error\nline 3 of error`,
      };
    }
  }
  return result;
}

describe("diagnoseDevelopmentFailure", () => {
  it("should produce reason from evaluator stderr for single failed gate", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({ failed: ["test"] });

    const diagnosis = diagnoseDevelopmentFailure(evaluation, evaluatorResult);

    expect(diagnosis.reason).toContain("test");
    expect(diagnosis.reason).toContain("something went wrong");
    expect(diagnosis.evidence).toBeDefined();
    expect(diagnosis.evidence!.length).toBeGreaterThan(0);
  });

  it("should produce reasons for multiple failed gates", () => {
    const evaluation = makeEvaluation(["lint", "test"]);
    const evaluatorResult = makeEvaluatorResult({ failed: ["lint", "test"] });

    const diagnosis = diagnoseDevelopmentFailure(evaluation, evaluatorResult);

    expect(diagnosis.reason).toContain("lint");
    expect(diagnosis.reason).toContain("test");
  });

  it("should fall back to hard_gates.detail when no evaluator result", () => {
    const evaluation = makeEvaluation(["typecheck"]);

    const diagnosis = diagnoseDevelopmentFailure(evaluation);

    expect(diagnosis.reason).toContain("typecheck");
    expect(diagnosis.reason).toContain("typecheck failed");
  });

  it("should handle no failed gates (edge case)", () => {
    const evaluation: EvaluationResult = {
      hard_gates: [],
      hard_gates_all_passed: true,
      weighted_score: 1.0,
    };

    const diagnosis = diagnoseDevelopmentFailure(evaluation);

    expect(diagnosis.reason).toBe("no failed hard gates");
  });

  it("should use stdout when stderr is empty", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "FAIL test output from stdout",
        stderr_tail: "",
      },
    };

    const diagnosis = diagnoseDevelopmentFailure(evaluation, evaluatorResult);

    expect(diagnosis.reason).toContain("test output from stdout");
  });

  it("should skip passed gates in reason", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult: EvaluatorResult = {
      lint: {
        command: "npm run lint",
        exit_code: 0,
        passed: true,
        duration_ms: 50,
        stdout_tail: "",
        stderr_tail: "",
      },
      test: {
        command: "npm test",
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "",
        stderr_tail: "test failed",
      },
    };

    const diagnosis = diagnoseDevelopmentFailure(evaluation, evaluatorResult);

    expect(diagnosis.reason).not.toContain("lint");
    expect(diagnosis.reason).toContain("test");
  });

  it("should handle gate with skip (command not found) but in hard_gates", () => {
    const evaluation = makeEvaluation(["lint", "test"]);
    const evaluatorResult: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "",
        stderr_tail: "test error",
      },
    };

    const diagnosis = diagnoseDevelopmentFailure(evaluation, evaluatorResult);

    expect(diagnosis.reason).toContain("lint");
    expect(diagnosis.reason).toContain("skip");
    expect(diagnosis.reason).toContain("test");
  });
});
