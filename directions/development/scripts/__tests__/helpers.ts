import type { EvaluationResult } from "../../../../core/scripts/types.js";

export function makeEvaluation(failedGates: string[]): EvaluationResult {
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
