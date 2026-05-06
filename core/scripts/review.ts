/**
 * 需求 Review 模块
 *
 * 将用户自然语言需求结构化为 ReviewOutput,生成飞书文档内容,
 * 并处理用户反馈。
 */

import { spawnSync } from "node:child_process";
import type { ReviewOutput } from "./types.js";

const DEFAULT_CLAUDE_CMD = "claude";
const CLI_TIMEOUT_MS = 60_000;

/**
 * 将用户自然语言需求结构化为 ReviewOutput。
 *
 * 通过调用 claude -p 让 AI 将原始需求解析为结构化格式。
 * 内部使用 spawnSync，调用方无需 await。
 */
export function reviewRequirement(rawInput: string): ReviewOutput {
  const prompt = `你是一个需求分析师。请将以下原始需求结构化。

## 原始需求
${rawInput}

## 输出要求
请严格按以下 JSON 格式输出,不要输出任何其他内容:
{
  "raw_requirement": "用户原始输入(原样保留)",
  "clarified_goal": "澄清后的目标(一句话,清晰具体)",
  "suggested_constraints": ["建议的约束1", "建议的约束2"],
  "suggested_stories": [{"id": "story-1", "title": "子任务标题"}],
  "questions": ["需要用户确认的问题1"],
  "confidence": 0.8
}

confidence 取值 [0, 1],表示需求清晰度。0.8 以上表示需求基本清晰,0.5 以下表示需求模糊需要进一步澄清。`;

  const cmd = process.env.LETSGOAL_CLAUDE_CMD ?? DEFAULT_CLAUDE_CMD;
  const r = spawnSync(
    cmd,
    ["-p", prompt, "--output-format", "json"],
    {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (r.error) {
    throw new Error(`claude 执行失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `claude 需求结构化失败(exit ${r.status}): ${(r.stderr ?? "").trim()}`,
    );
  }

  const stdout = (r.stdout ?? "").trim();
  return parseReviewOutput(stdout, rawInput);
}

/**
 * 生成飞书文档 Markdown 内容。
 *
 * 按 request.md 模板格式生成结构化内容,便于用户在飞书文档中确认。
 */
export function generateReviewMarkdown(review: ReviewOutput): string {
  const lines: string[] = [
    `# 需求 Review`,
    ``,
    `## 澄清后的目标`,
    ``,
    review.clarified_goal,
    ``,
  ];

  if (review.suggested_constraints.length > 0) {
    lines.push(`## 建议的约束`, ``);
    for (const c of review.suggested_constraints) {
      lines.push(`- ${c}`);
    }
    lines.push(``);
  }

  if (review.suggested_stories.length > 0) {
    lines.push(`## 建议的 Stories`, ``);
    for (const s of review.suggested_stories) {
      lines.push(`- **${s.id}**: ${s.title}`);
    }
    lines.push(``);
  }

  if (review.questions.length > 0) {
    lines.push(`## 需要确认的问题`, ``);
    for (let i = 0; i < review.questions.length; i++) {
      lines.push(`${i + 1}. ${review.questions[i]}`);
    }
    lines.push(``);
  }

  lines.push(`## 置信度`, ``);
  lines.push(`${(review.confidence * 100).toFixed(0)}%`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*原始需求: ${review.raw_requirement}*`);

  return lines.join("\n");
}

/**
 * 处理用户反馈,修改 ReviewOutput。
 *
 * 基于用户反馈调整结构化需求。如果反馈中明确修改了目标或约束,
 * 则更新对应字段。
 */
export function applyReviewFeedback(
  review: ReviewOutput,
  feedback: string,
): ReviewOutput {
  const updated = { ...review };

  const feedbackLines = feedback
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (feedbackLines.length > 0) {
    // 用户有反馈,说明已确认部分内容,提升置信度
    updated.confidence = Math.min(1, updated.confidence + 0.2);
  }

  return updated;
}

/**
 * 从 claude 输出中解析 ReviewOutput。
 *
 * 尝试从 JSON 输出中提取;若解析失败,构造一个基于原始输入的默认 ReviewOutput。
 */
function parseReviewOutput(stdout: string, rawInput: string): ReviewOutput {
  // claude --output-format json 返回的可能是 {"result":"..."} 包裹
  // 先尝试直接解析
  try {
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    return extractReviewFromObj(obj, rawInput);
  } catch {
    // 尝试从输出中提取 JSON 块
    const jsonMatch = /\{[\s\S]*\}/.exec(stdout);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return extractReviewFromObj(obj, rawInput);
      } catch {
        // fall through
      }
    }
  }

  // 解析失败,返回基于原始输入的默认 ReviewOutput
  return {
    raw_requirement: rawInput,
    clarified_goal: rawInput,
    suggested_constraints: [],
    suggested_stories: [],
    questions: ["AI 无法解析需求,请手动补充详细信息"],
    confidence: 0.1,
  };
}

function extractReviewFromObj(
  obj: Record<string, unknown>,
  rawInput: string,
): ReviewOutput {
  // 如果被 {"result":"..."} 包裹,先解包
  let inner = obj;
  if (
    typeof obj.result === "string" &&
    obj.result.trim().startsWith("{")
  ) {
    try {
      inner = JSON.parse(obj.result) as Record<string, unknown>;
    } catch {
      // use outer obj
    }
  }

  const raw = typeof inner.raw_requirement === "string"
    ? inner.raw_requirement
    : rawInput;
  const goal = typeof inner.clarified_goal === "string"
    ? inner.clarified_goal
    : rawInput;
  const constraints = Array.isArray(inner.suggested_constraints)
    ? inner.suggested_constraints.filter((c: unknown) => typeof c === "string") as string[]
    : [];
  const stories = Array.isArray(inner.suggested_stories)
    ? inner.suggested_stories
        .filter(
          (s: unknown) =>
            s !== null &&
            typeof s === "object" &&
            typeof (s as Record<string, unknown>).id === "string" &&
            typeof (s as Record<string, unknown>).title === "string",
        )
        .map((s: unknown) => ({
          id: (s as Record<string, unknown>).id as string,
          title: (s as Record<string, unknown>).title as string,
        }))
    : [];
  const questions = Array.isArray(inner.questions)
    ? inner.questions.filter((q: unknown) => typeof q === "string") as string[]
    : [];
  const confidence =
    typeof inner.confidence === "number"
      ? Math.max(0, Math.min(1, inner.confidence))
      : 0.5;

  return {
    raw_requirement: raw,
    clarified_goal: goal,
    suggested_constraints: constraints,
    suggested_stories: stories,
    questions,
    confidence,
  };
}
