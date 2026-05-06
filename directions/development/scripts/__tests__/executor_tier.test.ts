import { describe, it, expect } from "vitest";
import { buildPrompt } from "../executor.js";
import type { LoopTask } from "../../../../core/scripts/types.js";

function makeTask(overrides?: Partial<LoopTask>): LoopTask {
  return {
    task_id: "test-001",
    direction: "development",
    goal: "实现功能 X",
    success_criteria: { hard_gates: ["lint", "typecheck", "test"], min_score: 0.92 },
    constraints: ["使用 TypeScript"],
    forbidden_changes: [],
    config: { max_iterations: 5, min_score: 0.92, autonomy_mode: "standard" },
    workspace_path: "/tmp/letsgoal-test",
    request_path: "/tmp/request.md",
    status: "running",
    current_iteration: 0,
    best_score: 0,
    best_iteration: 0,
    direction_payload: { project_root: "/tmp/test-project" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildPrompt — tier-focused repair guidance (M4)", () => {
  it("includes L0 guidance when prevFailedTier is L0", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 2,
      prevFailedTier: "L0",
    });

    expect(prompt).toContain("L0 失败");
    expect(prompt).toContain("语法/类型错误");
    expect(prompt).toContain("不要尝试功能变更");
  });

  it("includes L1 guidance when prevFailedTier is L1", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 2,
      prevFailedTier: "L1",
    });

    expect(prompt).toContain("L0 已通过");
    expect(prompt).toContain("专注让测试通过");
  });

  it("includes L2 guidance when prevFailedTier is L2", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 2,
      prevFailedTier: "L2",
    });

    expect(prompt).toContain("功能已通过");
    expect(prompt).toContain("覆盖率和代码质量");
  });

  it("includes L3 guidance when prevFailedTier is L3", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 2,
      prevFailedTier: "L3",
    });

    expect(prompt).toContain("Skill 专项问题");
  });

  it("does not include tier guidance when prevFailedTier is undefined", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 2,
    });

    expect(prompt).not.toContain("分层修复指引");
  });

  it("does not include tier guidance on iteration 1", () => {
    const prompt = buildPrompt({
      task: makeTask(),
      iteration: 1,
      prevFailedTier: "L0",
    });

    // Tier guidance is under "if (iteration > 1)" block
    expect(prompt).not.toContain("分层修复指引");
  });
});
