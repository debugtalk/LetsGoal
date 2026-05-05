/**
 * 开发调试方向评估器
 *
 * 在 evaluate 阶段被 self_loop 调用,跑三件套(lint / typecheck / test)
 * 拿到结果。**只读** —— 不得修改任何文件。
 *
 * 命令发现策略(按优先级):
 *   1. DevTaskRequest.commands.<name>(显式)
 *   2. <project_root>/package.json 的 scripts.<name>
 *   3. <project_root>/.letsgoal-dev.json 的 commands.<name>
 *   4. 语言默认值(language 字段或自动探测)
 *   5. 都没找到 → 该门禁 skip(不算失败也不算通过)
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import type {
  DevCommands,
  DevGateName,
  DevTaskRequest,
  EvaluatorResult,
  EvaluatorRunResult,
  ProjectLanguage,
} from "./types.js";
import { asDevPayload, DEV_GATE_NAMES } from "./types.js";

import type { LoopTask } from "../../../core/scripts/types.js";
import type { EvalSuiteConfig } from "./eval_suite.js";
import {
  validateSkillSyntaxContent,
  runSkillEvalCases,
  skillSyntaxToRunResult,
  skillEvalToRunResult,
} from "./skill_eval.js";

// ============================================================================
// 配置
// ============================================================================


/** 单个命令的默认超时(毫秒)。M0 全局统一,M1+ 可分门禁配置。 */
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** stdout/stderr 截尾保留的行数 */
const TAIL_LINES = 100;

// ============================================================================
// 语言默认值
// ============================================================================

const LANGUAGE_DEFAULT_COMMANDS: Record<ProjectLanguage, DevCommands> = {
  typescript: {
    lint: "eslint .",
    typecheck: "tsc --noEmit",
    test: "vitest run",
  },
  javascript: {
    lint: "eslint .",
    test: "vitest run",
    // typecheck 不强制
  },
  python: {
    lint: "ruff check",
    typecheck: "mypy .",
    test: "pytest",
  },
  rust: {
    lint: "cargo clippy --all-targets -- -D warnings",
    typecheck: "cargo check --all-targets",
    test: "cargo test",
  },
  go: {
    lint: "golangci-lint run",
    typecheck: "go vet ./...",
    test: "go test ./...",
  },
  other: {},
};

// ============================================================================
// 语言探测
// ============================================================================

/**
 * 从项目根探测语言。优先返回显式 language;否则按文件特征猜。
 * 都不命中返回 "other"。
 */
export function detectLanguage(
  projectRoot: string,
  explicit?: ProjectLanguage,
): ProjectLanguage {
  if (explicit !== undefined) return explicit;
  if (existsSync(resolve(projectRoot, "package.json"))) {
    if (existsSync(resolve(projectRoot, "tsconfig.json"))) return "typescript";
    return "javascript";
  }
  if (
    existsSync(resolve(projectRoot, "pyproject.toml")) ||
    existsSync(resolve(projectRoot, "setup.py")) ||
    existsSync(resolve(projectRoot, "requirements.txt"))
  ) {
    return "python";
  }
  if (existsSync(resolve(projectRoot, "Cargo.toml"))) return "rust";
  if (existsSync(resolve(projectRoot, "go.mod"))) return "go";
  return "other";
}

// ============================================================================
// 命令发现
// ============================================================================

/**
 * 单个门禁的命令发现结果。
 */
export interface DiscoveredCommand {
  command: string; // 实际可执行命令字符串
  source:
    | "explicit" // DevTaskRequest.commands.<name>
    | "package_scripts" // package.json scripts
    | "letsgoal_dev_json" // .letsgoal-dev.json
    | "language_default"; // 语言默认值
}

interface PackageJsonScripts {
  [name: string]: string;
}

function readPackageScripts(projectRoot: string): PackageJsonScripts | null {
  const path = resolve(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: PackageJsonScripts };
    return parsed.scripts ?? {};
  } catch {
    return null;
  }
}

function readLetsgoalDevJson(projectRoot: string): { commands?: DevCommands } | null {
  const path = resolve(projectRoot, ".letsgoal-dev.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as { commands?: DevCommands };
  } catch {
    return null;
  }
}

/**
 * 按发现策略找单个门禁的命令。
 */
export function discoverCommand(
  gate: DevGateName,
  task: DevTaskRequest,
  language: ProjectLanguage,
  cachedPkgScripts?: Record<string, unknown> | null,
  cachedDevJson?: { commands?: DevCommands } | null,
): DiscoveredCommand | undefined {
  // 1. 显式
  const explicit = task.commands?.[gate];
  if (typeof explicit === "string" && explicit.length > 0) {
    return { command: explicit, source: "explicit" };
  }

  // 2. package.json scripts
  const pkgScripts = cachedPkgScripts ?? readPackageScripts(task.project_root);
  if (pkgScripts !== null && typeof pkgScripts[gate] === "string") {
    return { command: `npm run ${gate}`, source: "package_scripts" };
  }

  // 3. .letsgoal-dev.json
  const devJson = cachedDevJson ?? readLetsgoalDevJson(task.project_root);
  const fromDevJson = devJson?.commands?.[gate];
  if (typeof fromDevJson === "string" && fromDevJson.length > 0) {
    return { command: fromDevJson, source: "letsgoal_dev_json" };
  }

  // 4. 语言默认值
  const defaults = LANGUAGE_DEFAULT_COMMANDS[language];
  const defaultCmd = defaults[gate];
  if (typeof defaultCmd === "string" && defaultCmd.length > 0) {
    return { command: defaultCmd, source: "language_default" };
  }

  return undefined;
}

// ============================================================================
// 命令执行
// ============================================================================

interface RunCommandResult {
  exit_code: number;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
  timed_out: boolean;
}

/**
 * 在 cwd 下执行命令。shell=true 让 `npm run lint` 之类的复合命令可用。
 * stdout/stderr 同步收集,只保留末尾 TAIL_LINES 行。
 */
function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<RunCommandResult> {
  return new Promise((res) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // 兜底:5s 后还活着就 SIGKILL
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const duration = Date.now() - startedAt;
      const exitCode =
        typeof code === "number" ? code : signal !== null ? 128 : 1;
      res({
        exit_code: exitCode,
        duration_ms: duration,
        stdout_tail: tailLines(stdout, TAIL_LINES),
        stderr_tail: tailLines(stderr, TAIL_LINES),
        timed_out: timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const duration = Date.now() - startedAt;
      res({
        exit_code: 127,
        duration_ms: duration,
        stdout_tail: tailLines(stdout, TAIL_LINES),
        stderr_tail: tailLines(`${stderr}\nspawn error: ${err.message}`, TAIL_LINES),
        timed_out: false,
      });
    });
  });
}

function tailLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= n) return text;
  return lines.slice(lines.length - n).join("\n");
}

// ============================================================================
// 单门禁评估
// ============================================================================

async function evaluateGate(
  gate: DevGateName,
  task: DevTaskRequest,
  language: ProjectLanguage,
  cachedPkgScripts?: Record<string, unknown> | null,
  cachedDevJson?: { commands?: DevCommands } | null,
): Promise<EvaluatorRunResult | undefined> {
  const discovered = discoverCommand(gate, task, language, cachedPkgScripts, cachedDevJson);
  if (discovered === undefined) return undefined;

  const result = await runCommand(
    discovered.command,
    task.project_root,
    DEFAULT_COMMAND_TIMEOUT_MS,
  );

  // 超时单独标注在 stderr_tail 末尾
  const stderrTail = result.timed_out
    ? `${result.stderr_tail}\n[evaluator] command timed out after ${DEFAULT_COMMAND_TIMEOUT_MS}ms`
    : result.stderr_tail;

  return {
    command: discovered.command,
    exit_code: result.exit_code,
    passed: result.exit_code === 0 && !result.timed_out,
    duration_ms: result.duration_ms,
    stdout_tail: result.stdout_tail,
    stderr_tail: stderrTail,
  };
}

/**
 * 从 eval_suite.files 推导评测用例目录。
 * 取第一个 glob pattern 中 glob 元字符之前的最长路径前缀。
 * 若 eval_suite 未配置，默认 <project_root>/eval-cases。
 */
function resolveEvalCasesDir(
  projectRoot: string,
  evalSuite?: EvalSuiteConfig,
): string {
  if (!evalSuite || evalSuite.files.length === 0) {
    return resolve(projectRoot, "eval-cases");
  }
  // 从 glob pattern 提取目录前缀：取第一个 pattern，截断到 glob 元字符
  const pattern = evalSuite.files[0];
  const globIdx = pattern.search(/[*?\[{]/);
  const prefix = globIdx > 0 ? pattern.slice(0, globIdx) : pattern;
  const dir = prefix.replace(/\/+$/, "");
  return resolve(projectRoot, dir || "eval-cases");
}

// ============================================================================
// 顶层入口
// ============================================================================

/**
 * 跑完三件套,拼装 EvaluatorResult。
 * 缺失字段表示该门禁未发现命令,被 skip。
 *
 * M2.6: L0-L3 分层执行。L0 失败跳过 L1+；L1 失败跳过 L3。
 * - L0（结构）：lint + typecheck
 * - L1（功能）：test
 * - L2（质量）：coverage + soft scores（由 adapter 计算，evaluator 不跑额外命令）
 * - L3（专项）：skill_syntax + skill_eval（仅 skill 任务）
 */
export async function evaluateTask(task: LoopTask): Promise<EvaluatorResult> {
  const dev = asDevPayload(task.direction_payload);
  if (!existsSync(dev.project_root)) {
    throw new Error(`project_root 不存在: ${dev.project_root}`);
  }
  const language = detectLanguage(dev.project_root, dev.language);

  // 预读取配置，避免每个 gate 重复读文件
  const pkgScripts = readPackageScripts(dev.project_root);
  const devJson = readLetsgoalDevJson(dev.project_root);

  const result: EvaluatorResult = {};

  // L0: lint + typecheck（结构层）
  for (const gate of ["lint", "typecheck"] as const) {
    const r = await evaluateGate(gate, dev, language, pkgScripts, devJson);
    if (r !== undefined) result[gate] = r;
  }

  // L0 失败 → 跳过 L1-L3
  const l0Failed = (result.lint !== undefined && !result.lint.passed) ||
    (result.typecheck !== undefined && !result.typecheck.passed);
  if (l0Failed) return result;

  // L1: test（功能层）
  const testResult = await evaluateGate("test", dev, language, pkgScripts, devJson);
  if (testResult !== undefined) result.test = testResult;

  // L1 失败 → 跳过 L2-L3（L2 由 adapter 处理，evaluator 只跳过 L3）
  const l1Failed = result.test !== undefined && !result.test.passed;
  if (l1Failed) return result;

  // L2 由 adapter 计算 soft scores，evaluator 不跑额外命令

  // L3: Skill 专用门禁（task_type=skill_creation / skill_optimize 时额外运行）
  const isSkillTask = dev.task_type === "skill_creation" || dev.task_type === "skill_optimize";
  if (isSkillTask) {
    const skillPath = resolve(dev.project_root, "SKILL.md");
    let skillContent: string | undefined;
    try {
      skillContent = readFileSync(skillPath, "utf-8");
    } catch {
      // SKILL.md 不存在，两个 skill 门禁都会失败
    }

    // skill_syntax: 检查 SKILL.md 格式
    const syntaxResult = skillContent !== undefined
      ? validateSkillSyntaxContent(skillContent)
      : { valid: false, errors: ["SKILL.md 文件不存在"] };
    result.skill_syntax = skillSyntaxToRunResult(syntaxResult);

    // skill_eval: 检查 SKILL.md 是否满足评测用例
    const evalCasesDir = resolveEvalCasesDir(dev.project_root, dev.eval_suite);
    if (skillContent !== undefined && existsSync(evalCasesDir)) {
      const start = Date.now();
      const evalResult = runSkillEvalCases(skillContent, evalCasesDir);
      result.skill_eval = skillEvalToRunResult(evalResult, Date.now() - start);
    } else if (skillContent === undefined) {
      result.skill_eval = {
        command: "skill_eval",
        exit_code: 1,
        passed: false,
        duration_ms: 0,
        stdout_tail: "",
        stderr_tail: "SKILL.md 不存在，无法运行评测用例",
      };
    }
  }

  return result;
}

// ============================================================================
// CLI 入口(便于单测)
// ============================================================================

async function main(): Promise<void> {
  const taskPath = process.argv[2];
  if (taskPath === undefined) {
    process.stderr.write("用法: tsx evaluator.ts <path/to/task-state.json>\n");
    process.exit(2);
  }
  if (!existsSync(taskPath)) {
    process.stderr.write(`task 文件不存在: ${taskPath}\n`);
    process.exit(2);
  }
  const task = JSON.parse(readFileSync(taskPath, "utf-8")) as LoopTask;
  const result = await evaluateTask(task);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  // 退出码:任一硬门禁失败 → 1;全部 skip 也算 0(给上层判断)
  const anyFailed = DEV_GATE_NAMES.some((g) => result[g] !== undefined && !result[g]!.passed);
  process.exit(anyFailed ? 1 : 0);
}

const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`evaluator 失败: ${msg}\n`);
    process.exit(2);
  });
}
