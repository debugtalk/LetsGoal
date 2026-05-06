import { describe, it, expect } from "vitest";
import {
  extractCoverageFromOutput,
  computeSoftScores,
  computeWeightedScore,
  DEFAULT_SOFT_SCORE_WEIGHTS,
} from "../soft_scorer.js";
import type { EvaluatorResult } from "../types.js";

// ============================================================================
// extractCoverageFromOutput
// ============================================================================

describe("extractCoverageFromOutput", () => {
  it("extracts line coverage from vitest --coverage output", () => {
    const stdout = `
 % Coverage report from v8
----------|---------|----------|---------|---------|-------------------
File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|-------------------
All files |   80.00 |       75 |     100 |   80.00 |
 src.ts   |   80.00 |       75 |     100 |   80.00 | 12-15
----------|---------|----------|---------|---------|-------------------
`;
    expect(extractCoverageFromOutput(stdout)).toBeCloseTo(0.8, 2);
  });

  it("extracts line coverage from jest --coverage output", () => {
    const stdout = `
----------|---------|----------|---------|---------|-------------------
File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|-------------------
All files |   60.00 |       50 |      80 |   60.00 |
----------|---------|----------|---------|---------|-------------------
`;
    expect(extractCoverageFromOutput(stdout)).toBeCloseTo(0.6, 2);
  });

  it("returns undefined when no coverage data in output", () => {
    expect(extractCoverageFromOutput("tests passed")).toBeUndefined();
    expect(extractCoverageFromOutput("")).toBeUndefined();
  });

  it("handles 100% coverage", () => {
    const stdout = `
All files |     100 |      100 |     100 |     100 |
`;
    expect(extractCoverageFromOutput(stdout)).toBeCloseTo(1.0, 2);
  });

  it("extracts line coverage from vitest summary line only", () => {
    const stdout = "All files |      50 |       50 |      50 |      50 |";
    expect(extractCoverageFromOutput(stdout)).toBeCloseTo(0.5, 2);
  });
});

// ============================================================================
// computeSoftScores
// ============================================================================

describe("computeSoftScores", () => {
  it("computes coverage score = actual / target when actual >= target", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "All files |   80.00 |       75 |     100 |   80.00 |",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8);
    expect(scores.find((s) => s.name === "coverage")?.score).toBeCloseTo(1.0, 2);
  });

  it("caps coverage score at 1.0 when actual exceeds target", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "All files |   90.00 |       85 |     100 |   90.00 |",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8);
    expect(scores.find((s) => s.name === "coverage")?.score).toBeCloseTo(1.0, 2);
  });

  it("returns coverage score < 1.0 when actual below target", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "All files |   60.00 |       50 |      80 |   60.00 |",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8);
    // 0.6 / 0.8 = 0.75
    expect(scores.find((s) => s.name === "coverage")?.score).toBeCloseTo(0.75, 2);
  });

  it("defaults coverage score to 1.0 when no coverage data in output", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "✓ all tests passed",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8);
    expect(scores.find((s) => s.name === "coverage")?.score).toBeCloseTo(1.0, 2);
  });

  it("returns 4 soft score items with correct default weights", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8);
    expect(scores).toHaveLength(4);
    expect(scores.find((s) => s.name === "coverage")?.weight).toBeCloseTo(0.4, 2);
    expect(scores.find((s) => s.name === "complexity")?.weight).toBeCloseTo(0.2, 2);
    expect(scores.find((s) => s.name === "smells")?.weight).toBeCloseTo(0.2, 2);
    expect(scores.find((s) => s.name === "docs")?.weight).toBeCloseTo(0.2, 2);
  });

  it("stubs complexity, smells, docs at 1.0 (M3 initial)", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "npm test",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8);
    expect(scores.find((s) => s.name === "complexity")?.score).toBeCloseTo(1.0, 2);
    expect(scores.find((s) => s.name === "smells")?.score).toBeCloseTo(1.0, 2);
    expect(scores.find((s) => s.name === "docs")?.score).toBeCloseTo(1.0, 2);
  });

  it("handles empty evaluator result (no test gate)", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8);
    expect(scores).toHaveLength(4);
    expect(scores.find((s) => s.name === "coverage")?.score).toBeCloseTo(1.0, 2);
  });
});

// ============================================================================
// computeWeightedScore
// ============================================================================

describe("computeWeightedScore", () => {
  it("computes weighted sum of score * weight", () => {
    const scores = [
      { name: "coverage", score: 0.75, weight: 0.4 },
      { name: "complexity", score: 1.0, weight: 0.2 },
      { name: "smells", score: 1.0, weight: 0.2 },
      { name: "docs", score: 1.0, weight: 0.2 },
    ];
    // 0.75*0.4 + 1.0*0.2 + 1.0*0.2 + 1.0*0.2 = 0.3 + 0.6 = 0.9
    expect(computeWeightedScore(scores)).toBeCloseTo(0.9, 2);
  });

  it("returns 1.0 when all scores are 1.0", () => {
    const scores = [
      { name: "coverage", score: 1.0, weight: 0.4 },
      { name: "complexity", score: 1.0, weight: 0.2 },
      { name: "smells", score: 1.0, weight: 0.2 },
      { name: "docs", score: 1.0, weight: 0.2 },
    ];
    expect(computeWeightedScore(scores)).toBeCloseTo(1.0, 2);
  });

  it("returns 0.0 when all scores are 0.0", () => {
    const scores = [
      { name: "coverage", score: 0.0, weight: 0.4 },
      { name: "complexity", score: 0.0, weight: 0.2 },
      { name: "smells", score: 0.0, weight: 0.2 },
      { name: "docs", score: 0.0, weight: 0.2 },
    ];
    expect(computeWeightedScore(scores)).toBeCloseTo(0.0, 2);
  });

  it("handles partial coverage drop correctly", () => {
    const scores = [
      { name: "coverage", score: 0.5, weight: 0.4 },
      { name: "complexity", score: 1.0, weight: 0.2 },
      { name: "smells", score: 1.0, weight: 0.2 },
      { name: "docs", score: 1.0, weight: 0.2 },
    ];
    // 0.5*0.4 + 1.0*0.2 + 1.0*0.2 + 1.0*0.2 = 0.2 + 0.6 = 0.8
    expect(computeWeightedScore(scores)).toBeCloseTo(0.8, 2);
  });
});

// ============================================================================
// DEFAULT_SOFT_SCORE_WEIGHTS
// ============================================================================

describe("DEFAULT_SOFT_SCORE_WEIGHTS", () => {
  it("has 4 dimensions whose weights sum to 1.0", () => {
    const values = Object.values(DEFAULT_SOFT_SCORE_WEIGHTS) as number[];
    expect(values).toHaveLength(4);
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 2);
  });
});
