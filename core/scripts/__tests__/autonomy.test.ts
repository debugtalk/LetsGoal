import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  shouldPauseBeforeExecution,
  shouldPauseOnEscalation,
  claudePermissionMode,
  reportVerbosity,
  loadResumedState,
} from "../autonomy.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// shouldPauseBeforeExecution
// ============================================================================

describe("shouldPauseBeforeExecution", () => {
  it("strict → true", () => {
    expect(shouldPauseBeforeExecution("strict")).toBe(true);
  });

  it("standard → false", () => {
    expect(shouldPauseBeforeExecution("standard")).toBe(false);
  });

  it("autonomous → false", () => {
    expect(shouldPauseBeforeExecution("autonomous")).toBe(false);
  });
});

// ============================================================================
// shouldPauseOnEscalation
// ============================================================================

describe("shouldPauseOnEscalation", () => {
  it("strict → true", () => {
    expect(shouldPauseOnEscalation("strict")).toBe(true);
  });

  it("standard → false", () => {
    expect(shouldPauseOnEscalation("standard")).toBe(false);
  });

  it("autonomous → false", () => {
    expect(shouldPauseOnEscalation("autonomous")).toBe(false);
  });
});

// ============================================================================
// claudePermissionMode
// ============================================================================

describe("claudePermissionMode", () => {
  it("strict → default（每个工具调用需确认）", () => {
    expect(claudePermissionMode("strict")).toBe("default");
  });

  it("standard → bypassPermissions", () => {
    expect(claudePermissionMode("standard")).toBe("bypassPermissions");
  });

  it("autonomous → bypassPermissions", () => {
    expect(claudePermissionMode("autonomous")).toBe("bypassPermissions");
  });
});

// ============================================================================
// reportVerbosity
// ============================================================================

describe("reportVerbosity", () => {
  it("strict → full", () => {
    expect(reportVerbosity("strict")).toBe("full");
  });

  it("standard → full", () => {
    expect(reportVerbosity("standard")).toBe("full");
  });

  it("autonomous → minimal", () => {
    expect(reportVerbosity("autonomous")).toBe("minimal");
  });
});

// ============================================================================
// loadResumedState
// ============================================================================

describe("loadResumedState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "letsgoal-autonomy-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when task-state.json does not exist", () => {
    expect(loadResumedState(tmpDir)).toBeNull();
  });

  it("returns null when status is not awaiting_human or paused", () => {
    const lgDir = resolve(tmpDir, ".letsgoal");
    mkdirSync(lgDir, { recursive: true });
    writeFileSync(
      resolve(lgDir, "task-state.json"),
      JSON.stringify({ status: "running" }),
    );
    expect(loadResumedState(tmpDir)).toBeNull();
  });

  it("restores task from task-state.json when status is awaiting_human", () => {
    const lgDir = resolve(tmpDir, ".letsgoal");
    mkdirSync(lgDir, { recursive: true });
    const task = {
      task_id: "test-123",
      goal: "test goal",
      direction: "development",
      status: "awaiting_human",
      current_iteration: 2,
      best_score: 0,
      best_iteration: 0,
      config: { max_iterations: 4, min_score: 1.0, autonomy_mode: "strict" },
      workspace_path: tmpDir,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    writeFileSync(
      resolve(lgDir, "task-state.json"),
      JSON.stringify(task),
    );

    const state = loadResumedState(tmpDir);
    expect(state).not.toBeNull();
    expect(state!.task.task_id).toBe("test-123");
    expect(state!.task.status).toBe("running");
  });

  it("reconstructs previous evaluation/diagnosis from iterations.jsonl", () => {
    const lgDir = resolve(tmpDir, ".letsgoal");
    mkdirSync(lgDir, { recursive: true });
    const task = {
      task_id: "test-456",
      goal: "test",
      direction: "development",
      status: "awaiting_human",
      current_iteration: 2,
      best_score: 0.5,
      best_iteration: 1,
      config: { max_iterations: 4, min_score: 1.0, autonomy_mode: "strict" },
      workspace_path: tmpDir,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    writeFileSync(resolve(lgDir, "task-state.json"), JSON.stringify(task));

    const iterations = [
      {
        iteration: 1,
        status: "failed",
        evaluation: { hard_gates: [{ gate: "test", passed: false }], hard_gates_all_passed: false, weighted_score: 0 },
        diagnosis: { reason: "test failed", category: "test_failure" },
        changed_files: ["src/a.ts"],
        next_action: "retry",
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T00:00:01Z",
      },
      {
        iteration: 2,
        status: "failed",
        evaluation: { hard_gates: [{ gate: "typecheck", passed: false }], hard_gates_all_passed: false, weighted_score: 0 },
        diagnosis: { reason: "type error", category: "type_error" },
        changed_files: ["src/b.ts"],
        next_action: "retry",
        started_at: "2026-01-01T00:00:02Z",
        ended_at: "2026-01-01T00:00:03Z",
      },
    ];
    writeFileSync(
      resolve(lgDir, "iterations.jsonl"),
      iterations.map((i) => JSON.stringify(i)).join("\n") + "\n",
    );

    const state = loadResumedState(tmpDir);
    expect(state).not.toBeNull();
    expect(state!.iterations).toHaveLength(2);
    expect(state!.prevDiagnosis?.category).toBe("type_error");
    expect(state!.prevEvaluation?.hard_gates[0]?.gate).toBe("typecheck");
  });

  it("sets task status to running when resuming from awaiting_human", () => {
    const lgDir = resolve(tmpDir, ".letsgoal");
    mkdirSync(lgDir, { recursive: true });
    const task = {
      task_id: "test-789",
      goal: "test",
      direction: "development",
      status: "awaiting_human",
      current_iteration: 1,
      best_score: 0,
      best_iteration: 0,
      config: { max_iterations: 4, min_score: 1.0, autonomy_mode: "strict" },
      workspace_path: tmpDir,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    writeFileSync(resolve(lgDir, "task-state.json"), JSON.stringify(task));

    const state = loadResumedState(tmpDir);
    expect(state!.task.status).toBe("running");
  });
});
