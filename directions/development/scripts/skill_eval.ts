/**
 * Skill 评估门禁
 *
 * 当 task_type 为 skill_creation / skill_optimize 时,
 * 在三件套之外额外运行 skill 专用评估:
 *   - skill_syntax: 检查 SKILL.md 格式合规性
 *   - skill_eval: 检查 SKILL.md 是否包含评测用例要求的章节
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { EvaluatorRunResult } from "./types.js";

// ============================================================================
// Skill 语法校验
// ============================================================================

export interface SkillSyntaxResult {
  valid: boolean;
  errors: string[];
}

/**
 * 从文件路径校验 SKILL.md 语法合规性。
 */
export function validateSkillSyntax(skillPath: string): SkillSyntaxResult {
  try {
    const content = readFileSync(skillPath, "utf-8");
    return validateSkillSyntaxContent(content);
  } catch {
    return { valid: false, errors: ["SKILL.md 文件不存在"] };
  }
}

/**
 * 纯函数：从内容校验 SKILL.md 语法合规性。
 *
 *   1. YAML frontmatter 存在(以 --- 开头和结尾)
 *   2. frontmatter 中包含 name 和 description 字段
 *   3. 正文中包含「适用场景」章节
 */
export function validateSkillSyntaxContent(content: string): SkillSyntaxResult {
  const errors: string[] = [];

  if (!content.startsWith("---")) {
    return { valid: false, errors: ["缺少 YAML frontmatter(应以 --- 开头)"] };
  }

  const secondDash = content.indexOf("---", 3);
  if (secondDash === -1) {
    return { valid: false, errors: ["缺少 YAML frontmatter 结束标记(应以 --- 结尾)"] };
  }

  const frontmatter = content.slice(3, secondDash);
  if (!/^name\s*:/m.test(frontmatter)) {
    errors.push("frontmatter 中缺少 name 字段");
  }
  if (!/^description\s*:/m.test(frontmatter)) {
    errors.push("frontmatter 中缺少 description 字段");
  }

  const body = content.slice(secondDash + 3);
  if (!/^##\s+适用场景/m.test(body)) {
    errors.push("正文中缺少「适用场景」章节(## 适用场景)");
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Skill 评测用例
// ============================================================================

export interface SkillEvalCase {
  name: string;
  input: string;
  expected_sections: string[];
}

export interface SkillEvalResult {
  passed: number;
  failed: number;
  details: string[];
}

/**
 * 运行 Skill 评测用例（从 evalCasesDir 读取 JSON 文件，检查 SKILL.md 内容）。
 */
export function runSkillEvalCases(
  skillContent: string,
  evalCasesDir: string,
): SkillEvalResult {
  let jsonFiles: string[];
  try {
    jsonFiles = readdirSync(evalCasesDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return { passed: 0, failed: 0, details: [`评测用例目录不存在: ${evalCasesDir}`] };
  }

  if (jsonFiles.length === 0) {
    return { passed: 0, failed: 0, details: [`评测用例目录下没有 JSON 文件: ${evalCasesDir}`] };
  }

  let passed = 0;
  let failed = 0;
  const details: string[] = [];

  for (const file of jsonFiles) {
    const filePath = join(evalCasesDir, file);
    const raw = readFileSync(filePath, "utf-8");
    let evalCase: SkillEvalCase;
    try {
      evalCase = JSON.parse(raw) as SkillEvalCase;
    } catch {
      details.push(`${file}: JSON 解析失败`);
      failed++;
      continue;
    }

    if (!Array.isArray(evalCase.expected_sections)) {
      details.push(`${file}: 缺少 expected_sections 字段`);
      failed++;
      continue;
    }

    const missing = evalCase.expected_sections.filter(
      (section) => !skillContent.includes(section),
    );

    if (missing.length === 0) {
      passed++;
      details.push(`${evalCase.name ?? file}: PASS`);
    } else {
      failed++;
      details.push(`${evalCase.name ?? file}: FAIL — 缺少章节: ${missing.join(", ")}`);
    }
  }

  return { passed, failed, details };
}

// ============================================================================
// 适配为 EvaluatorRunResult
// ============================================================================

export function skillSyntaxToRunResult(
  result: SkillSyntaxResult,
): EvaluatorRunResult {
  return {
    command: "skill_syntax",
    exit_code: result.valid ? 0 : 1,
    passed: result.valid,
    duration_ms: 0,
    stdout_tail: "",
    stderr_tail: result.errors.join("\n"),
  };
}

export function skillEvalToRunResult(
  result: SkillEvalResult,
  durationMs: number,
): EvaluatorRunResult {
  const allPassed = result.failed === 0 && result.passed > 0;
  return {
    command: "skill_eval",
    exit_code: allPassed ? 0 : 1,
    passed: allPassed,
    duration_ms: durationMs,
    stdout_tail: "",
    stderr_tail: result.details.join("\n"),
  };
}
