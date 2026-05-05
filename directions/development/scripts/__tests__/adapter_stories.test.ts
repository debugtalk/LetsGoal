import { describe, it, expect } from "vitest";
import type { LoopTask, Story } from "../../../../core/scripts/types.js";

// 测试辅助函数,直接复制 adapter.ts 中的逻辑以避免导出私有函数
function currentPendingStory(task: LoopTask): Story | undefined {
  return task.stories?.find((s) => s.status === "pending");
}

function updateStoryStatus(task: LoopTask, passed: boolean): void {
  const current = currentPendingStory(task);
  if (!current) return;
  current.status = passed ? "passed" : "failed";
  current.passes = passed;
}

function allStoriesPassed(task: LoopTask): boolean {
  if (!task.stories || task.stories.length === 0) return true;
  return task.stories.every((s) => s.status === "passed");
}

describe("story scheduling helpers", () => {
  it("finds first pending story", () => {
    const stories: Story[] = [
      { id: "s1", title: "a", status: "pending", passes: false },
      { id: "s2", title: "b", status: "pending", passes: false },
    ];
    const task = { stories } as LoopTask;
    expect(currentPendingStory(task)?.id).toBe("s1");
  });

  it("updates pending story to passed", () => {
    const stories: Story[] = [
      { id: "s1", title: "a", status: "pending", passes: false },
    ];
    const task = { stories } as LoopTask;
    updateStoryStatus(task, true);
    expect(stories[0].status).toBe("passed");
    expect(stories[0].passes).toBe(true);
  });

  it("updates pending story to failed", () => {
    const stories: Story[] = [
      { id: "s1", title: "a", status: "pending", passes: false },
    ];
    const task = { stories } as LoopTask;
    updateStoryStatus(task, false);
    expect(stories[0].status).toBe("failed");
    expect(stories[0].passes).toBe(false);
  });

  it("returns true for allStoriesPassed when all passed", () => {
    const stories: Story[] = [
      { id: "s1", title: "a", status: "passed", passes: true },
      { id: "s2", title: "b", status: "passed", passes: true },
    ];
    const task = { stories } as LoopTask;
    expect(allStoriesPassed(task)).toBe(true);
  });

  it("returns false for allStoriesPassed when some pending", () => {
    const stories: Story[] = [
      { id: "s1", title: "a", status: "passed", passes: true },
      { id: "s2", title: "b", status: "pending", passes: false },
    ];
    const task = { stories } as LoopTask;
    expect(allStoriesPassed(task)).toBe(false);
  });

  it("returns true for allStoriesPassed when no stories", () => {
    const task = {} as LoopTask;
    expect(allStoriesPassed(task)).toBe(true);
  });
});
