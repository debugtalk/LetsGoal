import { describe, it, expect } from "vitest";
import { buildPrompt } from "../executor.js";
import type { ExecutorInput } from "../executor.js";

function makeTask(overrides?: Partial<ExecutorInput["task"]>): ExecutorInput["task"] {
  return {
    task_id: "test-1",
    direction: "development",
    goal: "fix bug",
    success_criteria: { hard_gates: ["test"], min_score: 1.0 },
    constraints: [],
    config: { max_iterations: 3, min_score: 1.0 },
    workspace_path: "/tmp/workspace",
    request_path: "/tmp/request.md",
    status: "running",
    current_iteration: 0,
    best_score: 0,
    best_iteration: 0,
    direction_payload: {
      project_root: "/tmp/project",
      task_type: "bugfix",
      bug_repro: "repro steps",
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ExecutorInput["task"];
}

describe("buildPrompt execution_style=structured", () => {
  it("includes hardcoded bugfix strategy", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 1,
      execution_style: "structured",
    });

    expect(prompt).toContain("Bugfix 策略");
    expect(prompt).toContain("定位根本原因");
  });

  it("does not mention ai_autonomous", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 1,
      execution_style: "structured",
    });

    expect(prompt).not.toContain("AI 自治");
  });
});

describe("buildPrompt execution_style=ai_autonomous", () => {
  it("uses abstract task type description instead of strategy", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 1,
      execution_style: "ai_autonomous",
    });

    expect(prompt).not.toContain("Bugfix 策略");
    expect(prompt).not.toContain("定位根本原因");
    expect(prompt).toContain("任务类型: bugfix");
  });

  it("includes ai_autonomous header", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 1,
      execution_style: "ai_autonomous",
    });

    expect(prompt).toContain("执行风格：AI 自治");
  });

  it("softens task instructions", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 1,
      execution_style: "ai_autonomous",
    });

    expect(prompt).not.toContain("目标是让三件套");
  });
});
