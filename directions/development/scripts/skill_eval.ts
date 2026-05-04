/**
 * Skill 评估门禁
 *
 * 当 task_type 为 skill_creation / skill_optimize 时,
 * 在三件套之外额外运行 skill 专用评估:
 *   - skill_syntax: 检查 SKILL.md 格式合规性
 *   - skill_eval: 检查 SKILL.md 是否包含评测用例要求的章节
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import type { EvaluatorRunResult } from "./types.js";

// ============================================================================
// Skill 语法校验
// ============================================================================

export interface SkillSyntaxResult {
  valid: boolean;
  errors: string[];
}

/**
 * 校验 SKILL.md 文件的语法合规性:
 *   1. 文件存在
 *   2. YAML frontmatter 存在(以 --- 开头和结尾)
 *   3. frontmatter 中包含 name 和 description 字段
 *   4. 正文中包含「适用场景」章节
 */
export function validateSkillSyntax(skillPath: string): SkillSyntaxResult {
  const errors: string[] = [];

  if (!existsSync(skillPath)) {
    return { valid: false, errors: ["SKILL.md 文件不存在"] };
  }

  const content = readFileSync(skillPath, "utf-8");

  if (!content.startsWith("---")) {
    errors.push("缺少 YAML frontmatter(应以 --- 开头)");
  }

  const secondDash = content.indexOf("---", 3);
  if (secondDash === -1) {
    errors.push("缺少 YAML frontmatter 结束标记(应以 --- 结尾)");
  }

  if (secondDash !== -1) {
    const frontmatter = content.slice(3, secondDash);
    if (!/^name\s*:/m.test(frontmatter)) {
      errors.push("frontmatter 中缺少 name 字段");
    }
    if (!/^description\s*:/m.test(frontmatter)) {
      errors.push("frontmatter 中缺少 description 字段");
    }
  }

  const body = secondDash !== -1 ? content.slice(secondDash + 3) : content;
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
 * 运行 Skill 评测用例:
 *   - 读取 evalCasesDir 下所有 JSON 文件
 *   - 每个 case 检查 SKILL.md 是否包含 expected_sections 中的所有章节
 *   - 返回通过/失败数量和详情
 */
export async function runSkillEvalCases(
  skillDir: string,
  evalCasesDir: string,
): Promise<SkillEvalResult> {
  const skillPath = resolve(skillDir, "SKILL.md");

  if (!existsSync(skillPath)) {
    return { passed: 0, failed: 0, details: ["SKILL.md 不存在，无法运行评测用例"] };
  }
  const content = readFileSync(skillPath, "utf-8");

  if (!existsSync(evalCasesDir)) {
    return { passed: 0, failed: 0, details: [`评测用例目录不存在: ${evalCasesDir}`] };
  }

  const jsonFiles = readdirSync(evalCasesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

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
      (section) => !content.includes(section),
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
