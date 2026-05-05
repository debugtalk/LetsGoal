/**
 * Markdown 任务请求解析器
 *
 * 把用户输入的 Markdown 任务文件(templates/request.md 模板)解析为
 * LoopTask 对象,可被 self_loop.ts 直接消费。
 *
 * 输入文件结构(详见各方向的 templates/request.md):
 *   ## 目标
 *   ## 项目根目录(开发调试方向特异)
 *   ## 约束
 *   ## 禁止改动
 *   ## Bug 复现(可选)
 *   ## 配置  ← YAML 代码块
 *
 * 用法:
 *   tsx core/scripts/parse_request.ts \
 *     --input /path/to/request.md \
 *     --workspace /path/to/workspace \
 *     [--output /path/to/task.json]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { parse as parseYaml } from "yaml";

import {
  DEFAULT_LOOP_CONFIG,
  type LoopDirection,
  type LoopTask,
  type LoopConfig,
  type SuccessCriteria,
  type AutonomyMode,
  type ExecutionStyle,
  type Story,
} from "./types.js";

import type {
  DevTaskRequest,
  DevTaskType,
  ProjectLanguage,
} from "../../directions/development/scripts/types.js";
import { DEV_GATE_NAMES } from "../../directions/development/scripts/types.js";
import type { EvalSuiteConfig } from "../../directions/development/scripts/eval_suite.js";

// ============================================================================
// Markdown 解析
// ============================================================================

/**
 * Markdown 章节(以 H2 划分)。
 */
interface MarkdownSection {
  title: string;
  content: string;
}

/**
 * 把 Markdown 按 H2(`## 标题`)切片。
 * 第一个 H2 之前的内容(顶部 H1 / 引言)会被丢弃。
 */
function splitByH2(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current !== null) sections.push(current);
      current = { title: match[1].trim(), content: "" };
    } else if (current !== null) {
      current.content += line + "\n";
    }
  }
  if (current !== null) sections.push(current);

  return sections;
}

/**
 * 检测一段内容是否仍是模板占位符。
 * 模板占位符的形式是行内或独占行的 `<xxx>`,例如:
 *   <一两句话描述这个任务要做什么>
 *   <被开发项目的绝对路径>
 *
 * 注:用户可能在正文中保留 `<>` 当作普通符号,本函数只在内容除引导块外都被
 * `<...>` 占据时返回 true。
 */
function isPlaceholder(content: string): boolean {
  const stripped = content
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">"))
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  if (stripped.length === 0) return true;
  // 仅由若干 `<...>` 段组成
  return /^(<[^<>\n]+>\s*)+$/.test(stripped);
}

/**
 * 提取章节正文(去掉引导块 `> ...` 与占位符)。
 */
function extractBody(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
}

/**
 * 把章节正文按列表项 `- ` 拆成数组。无列表项时整段视为单元素。
 * 占位符段返回空数组。
 */
function extractList(content: string): string[] {
  if (isPlaceholder(content)) return [];
  const body = extractBody(content);
  if (body.length === 0) return [];

  const items: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.replace(/^[-*]\s+/, "").trim();
      if (text.length > 0 && !isPlaceholderInline(text)) items.push(text);
    }
  }

  // 没有列表项时,把整段当作单条
  if (items.length === 0) {
    const collapsed = body.replace(/\s+/g, " ").trim();
    if (collapsed.length > 0 && !isPlaceholderInline(collapsed)) items.push(collapsed);
  }

  return items;
}

/**
 * 把章节正文当作单段文本提取。占位符返回空串。
 */
function extractScalar(content: string): string {
  if (isPlaceholder(content)) return "";
  const body = extractBody(content);
  // 去掉首尾的 `<>` 占位包裹
  if (/^<.+>$/.test(body)) return "";
  return body;
}

function isPlaceholderInline(text: string): boolean {
  return /^<[^<>]+>$/.test(text.trim());
}

function parseStories(raw: string): Story[] | undefined {
  const body = extractBody(raw);
  if (body.length === 0 || isPlaceholder(body)) return undefined;
  try {
    const parsed = parseYaml(body) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed
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
        status: "pending" as const,
      }));
  } catch {
    return undefined;
  }
}

/**
 * 从 `## 配置` 章节内容里提取 YAML 代码块文本。
 * 仅识别 ```yaml ... ``` 围栏。
 */
function extractYamlBlock(content: string): string {
  const match = /```ya?ml\s*\n([\s\S]*?)```/i.exec(content);
  if (match === null) {
    throw new Error("`## 配置` 章节缺少 ```yaml 代码块");
  }
  return match[1];
}

// ============================================================================
// 配置 YAML 校验
// ============================================================================

interface ConfigYaml {
  task_type?: DevTaskType;
  language?: ProjectLanguage;
  success_criteria?: {
    hard_gates?: string[];
    min_score?: number;
  };
  loop_config?: {
    max_iterations?: number;
    min_score?: number;
    autonomy_mode?: AutonomyMode;
    execution_style?: ExecutionStyle;
  };
  commands?: {
    lint?: string;
    typecheck?: string;
    test?: string;
  };
  coverage_target?: number;
  eval_suite?: EvalSuiteConfig;
  stories?: { id: string; title: string }[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseConfigYaml(raw: string): ConfigYaml {
  const parsed = parseYaml(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error("配置 YAML 解析结果不是对象");
  }
  return parsed as ConfigYaml;
}

// ============================================================================
// 主解析函数
// ============================================================================

export interface ParseRequestOptions {
  /** Markdown 文件绝对路径(用于 LoopTask.request_path) */
  requestPath: string;
  /** 工作目录绝对路径(用于 LoopTask.workspace_path) */
  workspacePath: string;
  /** 任务方向。M0 仅支持 development */
  direction?: LoopDirection;
}

export function parseMarkdownTask(
  markdown: string,
  opts: ParseRequestOptions,
): LoopTask {
  const direction = opts.direction ?? "development";
  if (direction !== "development") {
    throw new Error(`M0 暂不支持方向 "${direction}",仅支持 development`);
  }

  const sections = splitByH2(markdown);
  const sectionMap = new Map<string, string>();
  for (const s of sections) sectionMap.set(s.title, s.content);

  // ---------- 必填:目标 ----------
  const goalRaw = sectionMap.get("目标");
  if (goalRaw === undefined) {
    throw new Error("缺少 `## 目标` 章节");
  }
  const goal = extractScalar(goalRaw);
  if (goal.length === 0) {
    throw new Error("`## 目标` 章节为空或仍是模板占位符");
  }

  // ---------- 必填:项目根目录 ----------
  const projectRootRaw = sectionMap.get("项目根目录");
  if (projectRootRaw === undefined) {
    throw new Error("缺少 `## 项目根目录` 章节");
  }
  const projectRoot = extractScalar(projectRootRaw);
  if (projectRoot.length === 0) {
    throw new Error("`## 项目根目录` 为空或仍是模板占位符");
  }

  // ---------- 可选:约束 ----------
  const constraintsRaw = sectionMap.get("约束") ?? "";
  const constraints = extractList(constraintsRaw);

  // ---------- 可选:禁止改动 ----------
  const forbiddenRaw = sectionMap.get("禁止改动") ?? "";
  const forbiddenChanges = extractList(forbiddenRaw);

  // ---------- 可选:Bug 复现 ----------
  const bugReproRaw = sectionMap.get("Bug 复现") ?? sectionMap.get("Bug复现") ?? "";
  const bugRepro = bugReproRaw === "" ? "" : extractScalar(bugReproRaw);

  // ---------- 必填:配置 YAML ----------
  const configRaw = sectionMap.get("配置");
  if (configRaw === undefined) {
    throw new Error("缺少 `## 配置` 章节");
  }
  const config = parseConfigYaml(extractYamlBlock(configRaw));

  // ---------- 校验 task_type 与 bug_repro 的相容性 ----------
  const taskType: DevTaskType = config.task_type ?? "feature";
  if (taskType === "bugfix" && bugRepro.length === 0) {
    throw new Error("task_type=bugfix 时 `## Bug 复现` 章节必填");
  }

  // ---------- 组装 SuccessCriteria ----------
  const successCriteria: SuccessCriteria = {
    hard_gates: config.success_criteria?.hard_gates ?? ["lint", "typecheck", "test"],
    min_score: config.success_criteria?.min_score ?? DEFAULT_LOOP_CONFIG.min_score,
  };

  // ---------- 组装 LoopConfig ----------
  const loopConfig: LoopConfig = {
    max_iterations:
      config.loop_config?.max_iterations ?? DEFAULT_LOOP_CONFIG.max_iterations,
    min_score: config.loop_config?.min_score ?? DEFAULT_LOOP_CONFIG.min_score,
    autonomy_mode:
      config.loop_config?.autonomy_mode ?? DEFAULT_LOOP_CONFIG.autonomy_mode,
    execution_style: config.loop_config?.execution_style,
  };

  // ---------- 可选:Story 级追踪 ----------
  const storiesRaw = sectionMap.get("Stories");
  const stories = storiesRaw !== undefined ? parseStories(storiesRaw) : undefined;

  // ---------- 组装方向特异 payload ----------
  const devPayload: DevTaskRequest = {
    project_root: projectRoot,
    task_type: taskType,
  };
  if (config.language !== undefined) devPayload.language = config.language;
  if (config.commands !== undefined && hasAnyCommand(config.commands)) {
    const cmds: Partial<Record<string, string>> = {};
    for (const gate of DEV_GATE_NAMES) {
      const cmd = config.commands[gate];
      if (typeof cmd === "string" && cmd.length > 0) cmds[gate] = cmd;
    }
    if (Object.keys(cmds).length > 0) devPayload.commands = cmds as DevTaskRequest["commands"];
  }
  if (bugRepro.length > 0) devPayload.bug_repro = bugRepro;
  if (typeof config.coverage_target === "number") {
    devPayload.coverage_target = config.coverage_target;
  }
  if (config.eval_suite) {
    if (
      typeof config.eval_suite.version !== "string" ||
      config.eval_suite.version.length === 0
    ) {
      throw new Error("eval_suite.version 必须是非空字符串");
    }
    if (
      !Array.isArray(config.eval_suite.files) ||
      config.eval_suite.files.length === 0
    ) {
      throw new Error("eval_suite.files 必须是非空数组");
    }
    devPayload.eval_suite = config.eval_suite;
  }

  // ---------- 组装 LoopTask ----------
  const now = new Date().toISOString();
  const task: LoopTask = {
    task_id: generateTaskId(opts.requestPath),
    direction,
    goal,
    success_criteria: successCriteria,
    constraints,
    forbidden_changes: forbiddenChanges,
    config: loopConfig,
    workspace_path: opts.workspacePath,
    request_path: opts.requestPath,
    status: "draft",
    current_iteration: 0,
    best_score: 0,
    best_iteration: 0,
    direction_payload: devPayload as unknown as Record<string, unknown>,
    stories: stories && stories.length > 0 ? stories : undefined,
    created_at: now,
    updated_at: now,
  };

  return task;
}

function hasAnyCommand(c: { lint?: string; typecheck?: string; test?: string }): boolean {
  return Boolean(c.lint) || Boolean(c.typecheck) || Boolean(c.test);
}

/**
 * 生成 task_id:`<请求文件 basename 不含扩展名>-<时间戳>-<6 位随机>`
 */
function generateTaskId(requestPath: string): string {
  const stem = basename(requestPath).replace(/\.[^.]+$/, "");
  const safeStem = stem.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+$/, "");
  const rand = randomBytes(3).toString("hex");
  return `${safeStem}-${timestamp}-${rand}`;
}

// ============================================================================
// CLI 入口
// ============================================================================

interface CliArgs {
  input: string;
  workspace: string;
  output?: string;
  direction?: LoopDirection;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      workspace: { type: "string", short: "w" },
      output: { type: "string", short: "o" },
      direction: { type: "string", short: "d" },
    },
    allowPositionals: false,
  });

  if (!values.input) throw new Error("缺少 --input 参数");
  if (!values.workspace) throw new Error("缺少 --workspace 参数");

  const direction = (values.direction ?? "development") as LoopDirection;

  return {
    input: resolve(values.input),
    workspace: resolve(values.workspace),
    output: values.output ? resolve(values.output) : undefined,
    direction,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (!existsSync(args.input)) {
    throw new Error(`输入文件不存在: ${args.input}`);
  }

  const markdown = readFileSync(args.input, "utf-8");
  const task = parseMarkdownTask(markdown, {
    requestPath: args.input,
    workspacePath: args.workspace,
    direction: args.direction,
  });

  const json = JSON.stringify(task, null, 2);

  // 1. 写入 workspace/.letsgoal/task-state.json
  const stateDir = resolve(args.workspace, ".letsgoal");
  mkdirSync(stateDir, { recursive: true });
  const statePath = resolve(stateDir, "task-state.json");
  writeFileSync(statePath, json + "\n", "utf-8");

  // 2. 如果显式指定 --output,也写到那里
  if (args.output !== undefined) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, json + "\n", "utf-8");
  }

  // 3. 同时打印到 stdout 方便调试
  process.stdout.write(json + "\n");
}

// 仅当直接执行(非 import)时运行 CLI
const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`parse_request 失败: ${msg}\n`);
    process.exit(1);
  });
}
