import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateSkillSyntax } from "../skill_eval.js";

describe("validateSkillSyntax", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skill-eval-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("应对合法 SKILL.md 通过校验", () => {
    const skillPath = join(tempDir, "SKILL.md");
    writeFileSync(skillPath, [
      "---",
      "name: test-skill",
      "description: A test skill",
      "---",
      "",
      "# Test Skill",
      "",
      "## 适用场景",
      "",
      "- Test scenario",
    ].join("\n"));

    const result = validateSkillSyntax(skillPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("应对缺少 frontmatter 的 SKILL.md 报错", () => {
    const skillPath = join(tempDir, "SKILL.md");
    writeFileSync(skillPath, [
      "# Test Skill",
      "",
      "## 适用场景",
      "",
      "- Test scenario",
    ].join("\n"));

    const result = validateSkillSyntax(skillPath);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("缺少 YAML frontmatter(应以 --- 开头)");
  });

  it("应对缺少 name/description 的 SKILL.md 报错", () => {
    const skillPath = join(tempDir, "SKILL.md");
    writeFileSync(skillPath, [
      "---",
      "other: value",
      "---",
      "",
      "# Test Skill",
      "",
      "## 适用场景",
    ].join("\n"));

    const result = validateSkillSyntax(skillPath);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("frontmatter 中缺少 name 字段");
    expect(result.errors).toContain("frontmatter 中缺少 description 字段");
  });

  it("应对缺少适用场景的 SKILL.md 报错", () => {
    const skillPath = join(tempDir, "SKILL.md");
    writeFileSync(skillPath, [
      "---",
      "name: test-skill",
      "description: A test skill",
      "---",
      "",
      "# Test Skill",
    ].join("\n"));

    const result = validateSkillSyntax(skillPath);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("正文中缺少「适用场景」章节(## 适用场景)");
  });
});
