import { describe, it, expect } from "vitest";
import {
  computeSoftScores,
  extractLintWarnings,
  extractComplexityFromEslint,
} from "../soft_scorer.js";
import type { EvaluatorResult } from "../types.js";

// ============================================================================
// extractLintWarnings
// ============================================================================

describe("extractLintWarnings", () => {
  it("extracts warnings from eslint summary format", () => {
    expect(extractLintWarnings("5 problems (2 errors, 3 warnings)")).toBe(3);
  });

  it("extracts warnings with extra segments", () => {
    expect(extractLintWarnings("10 problems (5 errors, 5 warnings, 0 fixable)")).toBe(5);
  });

  it("returns 0 warnings when count is 0", () => {
    expect(extractLintWarnings("2 problems (2 errors, 0 warnings)")).toBe(0);
  });

  it("returns undefined when no match", () => {
    expect(extractLintWarnings("no lint issues")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractLintWarnings("")).toBeUndefined();
  });
});

// ============================================================================
// extractComplexityFromEslint
// ============================================================================

describe("extractComplexityFromEslint", () => {
  it("extracts complexity from eslint output", () => {
    const output = "src/foo.ts\n  15:5  warning  complexity (12)";
    expect(extractComplexityFromEslint(output)).toBe(12);
  });

  it("returns the max complexity when multiple matches", () => {
    const output = "src/a.ts\n  complexity (8)\nsrc/b.ts\n  complexity (15)";
    expect(extractComplexityFromEslint(output)).toBe(15);
  });

  it("returns undefined when no complexity matches", () => {
    expect(extractComplexityFromEslint("no complexity issues")).toBeUndefined();
  });
});

// ============================================================================
// computeSoftScores — smells dimension
// ============================================================================

describe("computeSoftScores — smells (M4)", () => {
  it("deducts score based on lint warnings", () => {
    const raw: EvaluatorResult = {
      lint: {
        command: "eslint .",
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "5 problems (1 errors, 4 warnings)",
        stderr_tail: "",
      },
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined);
    const smells = scores.find((s) => s.name === "smells")!;
    // 1 - 4/20 = 0.8
    expect(smells.score).toBeCloseTo(0.8, 2);
  });

  it("returns 0 smells score when warnings exceed MAX_LINT_WARNINGS", () => {
    const raw: EvaluatorResult = {
      lint: {
        command: "eslint .",
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "50 problems (10 errors, 40 warnings)",
        stderr_tail: "",
      },
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined);
    const smells = scores.find((s) => s.name === "smells")!;
    expect(smells.score).toBe(0);
  });

  it("returns 1.0 smells when no lint output", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined);
    const smells = scores.find((s) => s.name === "smells")!;
    expect(smells.score).toBeCloseTo(1.0, 2);
  });

  it("checks stderr when stdout has no warnings", () => {
    const raw: EvaluatorResult = {
      lint: {
        command: "eslint .",
        exit_code: 1,
        passed: false,
        duration_ms: 100,
        stdout_tail: "",
        stderr_tail: "5 problems (0 errors, 5 warnings)",
      },
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined);
    const smells = scores.find((s) => s.name === "smells")!;
    expect(smells.score).toBeCloseTo(0.75, 2);
  });
});

// ============================================================================
// computeSoftScores — complexity dimension
// ============================================================================

describe("computeSoftScores — complexity (M4)", () => {
  it("uses eslint complexity output when available", () => {
    const raw: EvaluatorResult = {
      lint: {
        command: "eslint .",
        exit_code: 0,
        passed: true,
        duration_ms: 100,
        stdout_tail: "src/foo.ts\n  15:5  warning  complexity (8)",
        stderr_tail: "",
      },
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined);
    const complexity = scores.find((s) => s.name === "complexity")!;
    // 1 - 8/20 = 0.6
    expect(complexity.score).toBeCloseTo(0.6, 2);
  });

  it("falls back to changedFiles heuristic", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined, ["a.ts", "b.ts", "c.ts"]);
    const complexity = scores.find((s) => s.name === "complexity")!;
    // 1 - 3/10 = 0.7
    expect(complexity.score).toBeCloseTo(0.7, 2);
  });

  it("returns 0 complexity when changedFiles exceeds baseline", () => {
    const raw: EvaluatorResult = {
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const manyFiles = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
    const scores = computeSoftScores(raw, 0.8, undefined, manyFiles);
    const complexity = scores.find((s) => s.name === "complexity")!;
    expect(complexity.score).toBe(0);
  });

  it("defaults to 1.0 when no data", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined);
    const complexity = scores.find((s) => s.name === "complexity")!;
    expect(complexity.score).toBeCloseTo(1.0, 2);
  });

  it("prefers eslint complexity over changedFiles heuristic", () => {
    const raw: EvaluatorResult = {
      lint: {
        command: "eslint .",
        exit_code: 0,
        passed: true,
        duration_ms: 100,
        stdout_tail: "complexity (5)",
        stderr_tail: "",
      },
      test: {
        command: "vitest run",
        exit_code: 0,
        passed: true,
        duration_ms: 1000,
        stdout_tail: "",
        stderr_tail: "",
      },
    };
    const scores = computeSoftScores(raw, 0.8, undefined, ["a.ts", "b.ts", "c.ts"]);
    const complexity = scores.find((s) => s.name === "complexity")!;
    // Should use eslint: 1 - 5/20 = 0.75, not changedFiles: 1 - 3/10 = 0.7
    expect(complexity.score).toBeCloseTo(0.75, 2);
  });
});

// ============================================================================
// computeSoftScores — docs dimension
// ============================================================================

describe("computeSoftScores — docs (M4)", () => {
  it("returns 1.0 when changed files include .md", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined, ["src/foo.ts", "README.md"]);
    const docs = scores.find((s) => s.name === "docs")!;
    expect(docs.score).toBeCloseTo(1.0, 2);
  });

  it("returns 1.0 when changed files include CHANGELOG", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined, ["src/foo.ts", "CHANGELOG.md"]);
    const docs = scores.find((s) => s.name === "docs")!;
    expect(docs.score).toBeCloseTo(1.0, 2);
  });

  it("returns 0.7 when no doc files in changed files", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined, ["src/foo.ts", "src/bar.ts"]);
    const docs = scores.find((s) => s.name === "docs")!;
    expect(docs.score).toBeCloseTo(0.7, 2);
  });

  it("returns 1.0 when no changed files provided", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined);
    const docs = scores.find((s) => s.name === "docs")!;
    expect(docs.score).toBeCloseTo(1.0, 2);
  });

  it("returns 1.0 when empty changed files array", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined, []);
    const docs = scores.find((s) => s.name === "docs")!;
    expect(docs.score).toBeCloseTo(1.0, 2);
  });

  it("detects readme case-insensitively", () => {
    const raw: EvaluatorResult = {};
    const scores = computeSoftScores(raw, 0.8, undefined, ["Readme.md"]);
    const docs = scores.find((s) => s.name === "docs")!;
    expect(docs.score).toBeCloseTo(1.0, 2);
  });
});

// ============================================================================
// computeSoftScores — backward compatibility
// ============================================================================

describe("computeSoftScores — backward compat (M4)", () => {
  it("works without changedFiles param (same as before)", () => {
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
    expect(scores).toHaveLength(4);
    expect(scores.find((s) => s.name === "coverage")?.score).toBeCloseTo(1.0, 2);
    expect(scores.find((s) => s.name === "complexity")?.score).toBeCloseTo(1.0, 2);
    expect(scores.find((s) => s.name === "smells")?.score).toBeCloseTo(1.0, 2);
    expect(scores.find((s) => s.name === "docs")?.score).toBeCloseTo(1.0, 2);
  });
});
