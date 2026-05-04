import { describe, it, expect } from "vitest";
import { parseMarkdownTask } from "../parse_request.js";

const VALID_REQUEST = `
## 目标
实现 fizzbuzz 函数，通过所有测试

## 项目根目录
/tmp/fizzbuzz-project

## 约束
- 使用 TypeScript
- 不引入新的运行时依赖

## 禁止改动
- package.json
- test/

## 配置

\`\`\`yaml
task_type: feature
language: typescript
success_criteria:
  hard_gates: [lint, typecheck, test]
loop_config:
  max_iterations: 3
  min_score: 1.0
\`\`\`
`;

describe("parseMarkdownTask", () => {
  it("should parse a valid development request", () => {
    const task = parseMarkdownTask(VALID_REQUEST, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    expect(task.goal).toBe("实现 fizzbuzz 函数，通过所有测试");
    expect(task.direction).toBe("development");
    expect(task.constraints).toEqual(["使用 TypeScript", "不引入新的运行时依赖"]);
    expect(task.forbidden_changes).toEqual(["package.json", "test/"]);
    expect(task.success_criteria.hard_gates).toEqual(["lint", "typecheck", "test"]);
    expect(task.config.max_iterations).toBe(3);
    expect(task.config.min_score).toBe(1.0);
  });

  it("should extract project_root into direction_payload", () => {
    const task = parseMarkdownTask(VALID_REQUEST, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    const payload = task.direction_payload;
    expect(payload.project_root).toBe("/tmp/fizzbuzz-project");
  });

  it("should throw when missing required ## 目标 section", () => {
    const md = `
## 项目根目录
/tmp/project

## 配置
\`\`\`yaml
task_type: feature
\`\`\`
`;

    expect(() =>
      parseMarkdownTask(md, {
        requestPath: "/tmp/request.md",
        workspacePath: "/tmp/workspace",
      }),
    ).toThrow("缺少 `## 目标` 章节");
  });

  it("should throw when missing required ## 项目根目录 section", () => {
    const md = `
## 目标
do something

## 配置
\`\`\`yaml
task_type: feature
\`\`\`
`;

    expect(() =>
      parseMarkdownTask(md, {
        requestPath: "/tmp/request.md",
        workspacePath: "/tmp/workspace",
      }),
    ).toThrow("缺少 `## 项目根目录` 章节");
  });

  it("should throw when goal is placeholder", () => {
    const md = `
## 目标
<一两句话描述这个任务要做什么>

## 项目根目录
/tmp/project

## 配置
\`\`\`yaml
task_type: feature
\`\`\`
`;

    expect(() =>
      parseMarkdownTask(md, {
        requestPath: "/tmp/request.md",
        workspacePath: "/tmp/workspace",
      }),
    ).toThrow("占位符");
  });

  it("should throw when missing ## 配置 section", () => {
    const md = `
## 目标
do something

## 项目根目录
/tmp/project
`;

    expect(() =>
      parseMarkdownTask(md, {
        requestPath: "/tmp/request.md",
        workspacePath: "/tmp/workspace",
      }),
    ).toThrow("缺少 `## 配置` 章节");
  });

  it("should throw when bugfix task missing Bug 复现", () => {
    const md = `
## 目标
fix a bug

## 项目根目录
/tmp/project

## 配置
\`\`\`yaml
task_type: bugfix
\`\`\`
`;

    expect(() =>
      parseMarkdownTask(md, {
        requestPath: "/tmp/request.md",
        workspacePath: "/tmp/workspace",
      }),
    ).toThrow("bugfix");
  });

  it("should parse bugfix with Bug 复现 section", () => {
    const md = `
## 目标
fix the fizzbuzz bug

## 项目根目录
/tmp/project

## Bug 复现
fizzbuzz(15) returns Fizz but expected FizzBuzz

## 配置
\`\`\`yaml
task_type: bugfix
language: typescript
\`\`\`
`;

    const task = parseMarkdownTask(md, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    expect(task.direction_payload.bug_repro).toContain("fizzbuzz(15)");
  });

  it("should default task_type to feature", () => {
    const md = `
## 目标
do something

## 项目根目录
/tmp/project

## 配置
\`\`\`yaml
task_type: feature
\`\`\`
`;

    const task = parseMarkdownTask(md, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    expect(task.direction_payload.task_type).toBe("feature");
  });

  it("should default hard_gates to [lint, typecheck, test]", () => {
    const md = `
## 目标
do something

## 项目根目录
/tmp/project

## 配置
\`\`\`yaml
language: typescript
\`\`\`
`;

    const task = parseMarkdownTask(md, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    expect(task.success_criteria.hard_gates).toEqual(["lint", "typecheck", "test"]);
  });

  it("should throw for non-development direction", () => {
    expect(() =>
      parseMarkdownTask(VALID_REQUEST, {
        requestPath: "/tmp/request.md",
        workspacePath: "/tmp/workspace",
        direction: "data-collection",
      }),
    ).toThrow("暂不支持");
  });

  it("should parse explicit commands", () => {
    const md = `
## 目标
do something

## 项目根目录
/tmp/project

## 配置
\`\`\`yaml
commands:
  lint: eslint .
  typecheck: tsc --noEmit
  test: vitest run
\`\`\`
`;

    const task = parseMarkdownTask(md, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    expect(task.direction_payload.commands).toEqual({
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      test: "vitest run",
    });
  });

  it("should generate deterministic task_id structure", () => {
    const task = parseMarkdownTask(VALID_REQUEST, {
      requestPath: "/tmp/request.md",
      workspacePath: "/tmp/workspace",
    });

    expect(task.task_id).toMatch(/^request-\d{14}-[0-9a-f]{6}$/);
  });
});
