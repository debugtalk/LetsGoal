import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildPrompt, extractAiLearnings } from "../executor.js";
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
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ExecutorInput["task"];
}

describe("buildPrompt learnings", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "lg-exec-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes learnings when file exists", () => {
    mkdirSync(resolve(tmpDir, ".letsgoal"), { recursive: true });
    writeFileSync(
      resolve(tmpDir, ".letsgoal", "learnings.md"),
      "## Learning: 2026-01-01\n**分类**: type_error\n**建议**: fix types",
      "utf-8",
    );

    const prompt = buildPrompt({
      task: makeTask({ workspace_path: tmpDir }),
      iteration: 1,
    });

    expect(prompt).toContain("过往经验");
    expect(prompt).toContain("fix types");
  });

  it("omits learnings block when file does not exist", () => {
    const prompt = buildPrompt({
      task: makeTask({ workspace_path: tmpDir }),
      iteration: 1,
    });

    expect(prompt).not.toContain("过往经验");
  });
});

describe("extractAiLearnings", () => {
  it("extracts learnings between heading and JSON", () => {
    const log = `Some output\n## Learnings\nI fixed the type mismatch. Next time check null first.\n\n\`\`\`json
{"changed_files": ["src/a.ts"], "commit_sha": "abc123"}
\`\`\``;

    const result = extractAiLearnings(log);
    expect(result).toBe("I fixed the type mismatch. Next time check null first.");
  });

  it("returns undefined when no learnings section", () => {
    const log = `Some output\n\`\`\`json
{"changed_files": [], "commit_sha": ""}
\`\`\``;

    const result = extractAiLearnings(log);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty learnings", () => {
    const log = `## Learnings\n\n\`\`\`json
{"changed_files": [], "commit_sha": ""}
\`\`\``;

    const result = extractAiLearnings(log);
    expect(result).toBeUndefined();
  });
});
