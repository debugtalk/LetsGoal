import { describe, it, expect } from "vitest";
import type { IterationResult } from "../../../../core/scripts/types.js";
import type { EvaluatorResult } from "../types.js";
import { diagnoseDevelopmentFailure } from "../diagnose.js";

import { makeEvaluation } from "./helpers.js";

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
        stderr_tail: `${gate} error: something went wrong`,
      };
    }
  }
  return result;
}

function makeIterationResult(
  category: string,
  overrides?: Partial<IterationResult>,
): IterationResult {
  return {
    iteration: 1,
    status: "failed",
    evaluation: makeEvaluation(["test"]),
    diagnosis: { category, reason: "test" },
    changed_files: [],
    commit_sha: undefined,
    next_action: "retry",
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("diagnoseDevelopmentFailure — iterationHistory (M4)", () => {
  it("passes iterationHistory to classifier", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({ failed: ["test"] });
    const history: IterationResult[] = [
      makeIterationResult("test_failure", { iteration: 1 }),
      makeIterationResult("test_failure", { iteration: 2 }),
      makeIterationResult("test_failure", { iteration: 3 }),
    ];

    const diagnosis = diagnoseDevelopmentFailure(
      evaluation,
      evaluatorResult,
      undefined,
      undefined,
      history,
    );

    // 3 consecutive test_failure → architecture_mismatch
    expect(diagnosis.category).toBe("architecture_mismatch");
  });

  it("works without iterationHistory (backward compat)", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({ failed: ["test"] });

    const diagnosis = diagnoseDevelopmentFailure(evaluation, evaluatorResult);

    expect(diagnosis.category).toBe("test_failure");
  });

  it("works with empty iterationHistory", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({ failed: ["test"] });

    const diagnosis = diagnoseDevelopmentFailure(
      evaluation,
      evaluatorResult,
      undefined,
      undefined,
      [],
    );

    expect(diagnosis.category).toBe("test_failure");
  });

  it("detects requirement_ambiguity from history with empty commit", () => {
    const evaluation = makeEvaluation(["test"]);
    const evaluatorResult = makeEvaluatorResult({ failed: ["test"] });
    const history: IterationResult[] = [
      makeIterationResult("test_failure", {
        iteration: 1,
        commit_sha: undefined,
        changed_files: [],
      }),
    ];

    const diagnosis = diagnoseDevelopmentFailure(
      evaluation,
      evaluatorResult,
      undefined,
      undefined,
      history,
    );

    expect(diagnosis.category).toBe("requirement_ambiguity");
  });
});
