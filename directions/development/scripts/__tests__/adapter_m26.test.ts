import { describe, it, expect } from "vitest";
import type { EvaluationResult, HardGateResult } from "../../../../core/scripts/types.js";

// ============================================================================
// EvaluationResult.failed_tier 测试
// ============================================================================

describe("EvaluationResult.failed_tier (M2.6)", () => {
  it("failed_tier is optional and defaults to undefined", () => {
    const result: EvaluationResult = {
      hard_gates: [
        { gate: "lint", passed: true },
        { gate: "typecheck", passed: true },
        { gate: "test", passed: true },
      ],
      hard_gates_all_passed: true,
      weighted_score: 1.0,
    };

    expect(result.failed_tier).toBeUndefined();
  });

  it("failed_tier can be set to L0", () => {
    const result: EvaluationResult = {
      hard_gates: [
        { gate: "typecheck", passed: false, detail: "type error" },
      ],
      hard_gates_all_passed: false,
      weighted_score: 0,
      failed_tier: "L0",
    };

    expect(result.failed_tier).toBe("L0");
  });

  it("failed_tier can be set to L2 when hard gates pass but score is low", () => {
    const result: EvaluationResult = {
      hard_gates: [
        { gate: "lint", passed: true },
        { gate: "typecheck", passed: true },
        { gate: "test", passed: true },
      ],
      hard_gates_all_passed: true,
      weighted_score: 0.5,
      failed_tier: "L2",
    };

    expect(result.failed_tier).toBe("L2");
  });
});

// ============================================================================
// adapter evaluatorResultToEvaluation failed_tier 逻辑验证
// ============================================================================

describe("failed_tier logic in evaluatorResultToEvaluation (M2.6)", () => {
  // 模拟 adapter 内部的 failed_tier 判定逻辑
  function determineFailedTier(hardGates: HardGateResult[], allPassed: boolean, weightedScore: number): string | undefined {
    if (!allPassed || weightedScore < 1.0) {
      const l0Gates = new Set(["lint", "typecheck"]);
      const l0Failed = hardGates.some((g) => l0Gates.has(g.gate) && !g.passed);
      if (l0Failed) return "L0";
      if (hardGates.some((g) => g.gate === "test" && !g.passed)) return "L1";
      if (hardGates.some((g) => g.gate === "coverage" && !g.passed) || (allPassed && weightedScore < 1.0)) return "L2";
      if (hardGates.some((g) => (g.gate === "skill_syntax" || g.gate === "skill_eval") && !g.passed)) return "L3";
    }
    return undefined;
  }

  it("L0: typecheck failed → L0", () => {
    const gates: HardGateResult[] = [
      { gate: "typecheck", passed: false, detail: "type error" },
      { gate: "test", passed: true },
    ];
    expect(determineFailedTier(gates, false, 0)).toBe("L0");
  });

  it("L0: lint failed → L0", () => {
    const gates: HardGateResult[] = [
      { gate: "lint", passed: false, detail: "lint error" },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: true },
    ];
    expect(determineFailedTier(gates, false, 0)).toBe("L0");
  });

  it("L1: test failed (L0 passed) → L1", () => {
    const gates: HardGateResult[] = [
      { gate: "lint", passed: true },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: false, detail: "test failed" },
    ];
    expect(determineFailedTier(gates, false, 0)).toBe("L1");
  });

  it("L2: all hard gates passed but low score → L2", () => {
    const gates: HardGateResult[] = [
      { gate: "lint", passed: true },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: true },
    ];
    expect(determineFailedTier(gates, true, 0.6)).toBe("L2");
  });

  it("L2: coverage gate failed → L2", () => {
    const gates: HardGateResult[] = [
      { gate: "lint", passed: true },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: true },
      { gate: "coverage", passed: false, detail: "coverage too low" },
    ];
    expect(determineFailedTier(gates, false, 0)).toBe("L2");
  });

  it("L3: skill gates failed → L3", () => {
    const gates: HardGateResult[] = [
      { gate: "lint", passed: true },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: true },
      { gate: "skill_syntax", passed: false, detail: "invalid format" },
    ];
    expect(determineFailedTier(gates, false, 0)).toBe("L3");
  });

  it("no failure → undefined", () => {
    const gates: HardGateResult[] = [
      { gate: "lint", passed: true },
      { gate: "typecheck", passed: true },
      { gate: "test", passed: true },
    ];
    expect(determineFailedTier(gates, true, 1.0)).toBeUndefined();
  });
});
