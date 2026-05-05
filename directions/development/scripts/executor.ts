/**
 * 开发调试方向执行器
 *
 * 在 execute 阶段被 self_loop 调用,负责:
 *   1. 用 LoopTask + 上一轮评估/归因 组装一份 prompt
 *   2. 在 project_root 下 spawn `claude -p <prompt> --permission-mode bypassPermissions`
 *   3. Claude 改完代码后自己 git commit;executor 兜底再补一次 commit
 *   4. 通过 git 主线 + Claude JSON 摘要副线 收集本轮产物
 *
 * 子进程日志完整落到 <workspace>/.letsgoal/iterations/iter-N.log,
 * 末尾 200 行回传给 self_loop,便于在 diagnose 阶段使用。
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";

import type {
  AutonomyMode,
  Diagnosis,
  LoopTask,
  ExecutionStyle,
} from "../../../core/scripts/types.js";
import { EXECUTION_STYLE_AI_AUTONOMOUS, EXECUTION_STYLE_STRUCTURED } from "../../../core/scripts/types.js";
import type {
  EvaluatorResult,
  EvaluatorRunResult,
} from "./types.js";
import { asDevPayload } from "./types.js";
import { CATEGORY_REPAIR_HINTS, isDiagnosisCategory } from "./classifier.js";
import type { DiagnosisCategory } from "./classifier.js";
import { claudePermissionMode } from "../../../core/scripts/autonomy.js";
import { readLearnings } from "../../../core/scripts/learnings.js";

// ============================================================================
// 配置
// ============================================================================

/** 单轮执行默认超时(毫秒),可通过 env 覆盖 */
const DEFAULT_EXECUTE_TIMEOUT_MS = 20 * 60 * 1000;

/** 子进程日志回传给 self_loop 的截尾行数 */
const LOG_TAIL_LINES = 200;

/** 默认调用的可执行文件,可通过 env 覆盖(便于本地 mock 测试) */
const DEFAULT_EXECUTOR_CMD = "claude";

// ============================================================================
// 输入输出
// ============================================================================

export interface ExecutorInput {
  task: LoopTask;
  iteration: number; // 当前轮次,从 1 开始
  prevEvaluation?: EvaluatorResult;
  prevDiagnosis?: Diagnosis;
  execution_style?: ExecutionStyle; // M2.5: 执行风格覆盖
  prevFailedTier?: string; // M2.6: 上一轮失败层级 L0/L1/L2/L3
}

export interface ExecutorOutput {
  changed_files: string[]; // git diff --name-only HEAD~1
  commit_sha?: string; // git rev-parse HEAD;若本轮没产生 commit 则缺失
  log_path: string; // 子进程完整日志落盘位置
  log_tail: string; // 末尾 LOG_TAIL_LINES 行
  claude_exit_code: number;
  duration_ms: number;
  /** Claude 自己输出的 JSON 摘要(若 prompt 末尾要求格式正确解析) */
  claude_summary?: { changed_files: string[]; commit_sha: string };
  /** M2.5: Claude 自省产出的 learnings */
  ai_learnings?: string;
}

// ============================================================================
// Prompt 组装
// ============================================================================

const PROMPT_HEADER = "你正在执行 LetsGoal 开发调试方向的自循环。";

function categoryRepairHint(category: DiagnosisCategory): string | null {
  return CATEGORY_REPAIR_HINTS[category] ?? null;
}

const TASK_TYPE_PROMPTS: Record<string, { structured: string; autonomous: string }> = {
  bugfix: {
    structured:
      "# Bugfix 策略\n" +
      "你正在修复 bug。遵循以下步骤：\n" +
      "1. 根据 Bug 复现步骤确认 bug 存在\n" +
      "2. 定位根本原因（不要只修表面症状）\n" +
      "3. 编写最小化修复（不要重写整段逻辑）\n" +
      "4. 确保修复不会破坏现有测试",
    autonomous: "# 任务类型: bugfix\n你正在修复 bug。请自行分析 bug 根因并决定最佳修复方案。",
  },
  refactor: {
    structured:
      "# Refactor 策略\n" +
      "你正在重构代码。关键约束：\n" +
      "1. 所有现有测试必须继续通过——重构不改变行为\n" +
      "2. 不改变公共 API（函数签名、导出名称、返回类型）\n" +
      "3. 不添加新功能——只重组现有代码\n" +
      "4. 每次提交只做一项重构，便于回滚",
    autonomous: "# 任务类型: refactor\n你正在重构代码。请自行决定重构范围与方式，确保不破坏现有行为。",
  },
  skill_creation: {
    structured:
      "# Skill 创建指导\n" +
      "你正在创建一个 Claude Code Skill。Skill 必须遵循 SKILL.md 格式，包含：\n" +
      "1. YAML frontmatter（name + description）\n" +
      "2. 适用场景和跳过条件\n" +
      "3. 输入/输出契约\n" +
      "4. 执行步骤\n" +
      "Skill 必须能被 Claude Code 正确加载和使用。",
    autonomous: "# 任务类型: skill_creation\n你正在创建一个 Claude Code Skill。请自行决定 Skill 的最佳结构与内容。",
  },
  skill_optimize: {
    structured:
      "# Skill 优化指导\n" +
      "你正在优化一个现有的 Claude Code Skill。目标：提高 Skill 的评测通过率。\n" +
      "不要修改评测用例（它们是冻结的）。只修改 Skill 定义文件。",
    autonomous: "# 任务类型: skill_optimize\n你正在优化一个现有的 Claude Code Skill。请自行决定优化方向与策略。",
  },
};

function taskTypeStrategy(taskType: string | undefined, style: ExecutionStyle): string | undefined {
  const entry = TASK_TYPE_PROMPTS[taskType ?? ""];
  if (!entry) return undefined;
  return style === EXECUTION_STYLE_AI_AUTONOMOUS ? entry.autonomous : entry.structured;
}

function bullet(items: string[] | undefined): string {
  if (!items || items.length === 0) return "(无)";
  return items.map((it) => `- ${it}`).join("\n");
}

function gateLine(name: string, r?: EvaluatorRunResult): string {
  if (r === undefined) return `- ${name}: SKIP(未发现命令)`;
  if (r.passed) return `- ${name}: PASS (${r.command})`;
  const stderr = r.stderr_tail.trim();
  const stdout = r.stdout_tail.trim();
  // 优先 stderr,空时退回 stdout
  const detail = stderr.length > 0 ? stderr : stdout;
  return `- ${name}: FAIL (${r.command})\n\`\`\`\n${detail}\n\`\`\``;
}

function recentCommitLog(projectRoot: string, max = 10): string {
  const r = spawnSync(
    "git",
    [
      "log",
      `--max-count=${max}`,
      "--pretty=format:%h %s",
      "--grep=letsgoal(iter-",
    ],
    { cwd: projectRoot, encoding: "utf-8" },
  );
  if (r.status !== 0) return "(无 letsgoal 历史 commit)";
  const out = r.stdout.trim();
  return out.length > 0 ? out : "(无 letsgoal 历史 commit)";
}

export function buildPrompt(input: ExecutorInput): string {
  const dev = asDevPayload(input.task.direction_payload);
  const { task, iteration } = input;

  const blocks: string[] = [];
  blocks.push(PROMPT_HEADER);

  // M2.5: 加载过往经验
  const executionStyle = input.execution_style ?? EXECUTION_STYLE_STRUCTURED;
  const learnings = readLearnings(task.workspace_path);
  if (learnings.length > 0) {
    blocks.push(`# 过往经验(learnings)\n以下是从之前轮次沉淀下来的经验，供你参考：\n\n${learnings}`);
  }

  // 执行风格上下文（M2.5）
  if (executionStyle === EXECUTION_STYLE_AI_AUTONOMOUS) {
    blocks.push("# 执行风格：AI 自治\n你处于 AI 自治模式。请自行判断最佳修复方案，不需要严格遵循预设策略。评估结果仅作为参考信息。");
  }

  // 自主模式上下文（M2）
  const autonomyMode = task.config.autonomy_mode ?? "standard";
  if (autonomyMode === "strict") {
    blocks.push("# 自主模式：strict\n你处于严格自主模式。在重大架构决策前应暂停，不要做出可能破坏系统的变更。优先安全性和可回退性。");
  } else if (autonomyMode === "autonomous") {
    blocks.push("# 自主模式：autonomous\n你处于完全自主模式。自行做出所有决策，优先效率和完整性。");
  }

  // 任务核心
  blocks.push(`# 任务目标\n${task.goal}`);
  blocks.push(`# 项目根目录\n${dev.project_root}`);
  blocks.push(`# 任务类型\n${dev.task_type ?? "feature"}`);

  if (dev.task_type === "bugfix" && dev.bug_repro) {
    blocks.push(`# Bug 复现\n${dev.bug_repro}`);
  }

  const strategy = taskTypeStrategy(dev.task_type, executionStyle);
  if (strategy) blocks.push(strategy);

  blocks.push(`# 约束\n${bullet(task.constraints)}`);
  blocks.push(`# 禁止改动(任何情况下不得修改)\n${bullet(task.forbidden_changes)}`);

  blocks.push(
    `# 当前轮次\n第 ${iteration} 轮 / 最多 ${task.config.max_iterations} 轮`,
  );

  // 上一轮信息(N>1 时)
  if (iteration > 1) {
    // M2.6: 分层修复指引
    if (input.prevFailedTier !== undefined) {
      const tierGuidance: Record<string, string> = {
        L0: "上一轮在 L0 失败（语法/类型错误），仅修复这些基础问题，不要尝试功能变更",
        L1: "L0 已通过，专注让测试通过",
        L2: "功能已通过，专注提高覆盖率和代码质量",
        L3: "功能和质量已通过，专注修复 Skill 专项问题",
      };
      const guidance = tierGuidance[input.prevFailedTier];
      if (guidance) {
        blocks.push(`# 分层修复指引\n${guidance}`);
      }
    }
    if (input.prevEvaluation !== undefined) {
      const e = input.prevEvaluation;
      const gateLines = [
        gateLine("lint", e.lint),
        gateLine("typecheck", e.typecheck),
        gateLine("test", e.test),
      ];
      if (e.skill_syntax !== undefined) {
        gateLines.push(gateLine("skill_syntax", e.skill_syntax));
      }
      if (e.skill_eval !== undefined) {
        gateLines.push(gateLine("skill_eval", e.skill_eval));
      }
      blocks.push(
        ["# 上一轮评估", ...gateLines].join("\n"),
      );
    }
    if (input.prevDiagnosis !== undefined) {
      const lines = [`# 上一轮失败归因`, input.prevDiagnosis.reason];
      if (input.prevDiagnosis.category && isDiagnosisCategory(input.prevDiagnosis.category)) {
        lines.push(`归因分类: ${input.prevDiagnosis.category}`);
        // M2.5: ai_autonomous 模式下不注入修复建议,让 AI 自行判断
        if (executionStyle !== EXECUTION_STYLE_AI_AUTONOMOUS) {
          const hint = categoryRepairHint(input.prevDiagnosis.category);
          if (hint) lines.push(`修复建议: ${hint}`);
        }
      }
      if (input.prevDiagnosis.evidence && input.prevDiagnosis.evidence.length > 0) {
        lines.push("");
        lines.push("证据:");
        for (const ev of input.prevDiagnosis.evidence) lines.push(`- ${ev}`);
      }
      blocks.push(lines.join("\n"));
    }

    blocks.push(
      `# 历史 commit(letsgoal 轮次)\n\`\`\`\n${recentCommitLog(dev.project_root)}\n\`\`\``,
    );
  }

  // 三件套命令(透传给 Claude,让它知道评估器会跑什么)
  if (dev.commands) {
    const cmdLines = ["# 评估器会执行的命令(三件套)"];
    if (dev.commands.lint) cmdLines.push(`- lint: ${dev.commands.lint}`);
    if (dev.commands.typecheck) cmdLines.push(`- typecheck: ${dev.commands.typecheck}`);
    if (dev.commands.test) cmdLines.push(`- test: ${dev.commands.test}`);
    if (cmdLines.length > 1) blocks.push(cmdLines.join("\n"));
  }

  // M2.5: Story 上下文
  const stories = task.stories;
  if (stories && stories.length > 0) {
    const current = stories.find((s) => s.status === "pending");
    if (current) {
      blocks.push(
        `# 当前 Story\n- ID: ${current.id}\n- 标题: ${current.title}\n本轮聚焦实现当前 Story，不要处理其他 Story。`,
      );
    }
  }

  // 任务要点
  if (executionStyle === EXECUTION_STYLE_AI_AUTONOMOUS) {
    blocks.push(
      [
        "# 你这一轮要做的事",
        `1. 在 project_root (\`${dev.project_root}\`) 下做出代码改动。`,
        `2. 完成后在 project_root 执行 \`git add -A && git commit -m "letsgoal(iter-${iteration}): <一句话总结>"\`。`,
        "3. 最后，在 JSON 摘要之前，请输出一段反思，标题为 `## Learnings`。内容是你这一轮踩了什么坑、下次该怎么做。自由格式，2-5 句话即可。",
        "4. 最后单独输出一行 JSON 摘要(便于解析),格式严格如下:",
        `\`\`\`json
{"changed_files": ["<相对路径>", ...], "commit_sha": "<完整 SHA>"}
\`\`\``,
        "5. 如果你判断这一轮无法解决,不要硬改。直接在 JSON 摘要里把 commit_sha 留空,并把决策理由写在 JSON 之前的文字里。",
      ].join("\n"),
    );
  } else {
    blocks.push(
      [
        "# 你这一轮要做的事",
        `1. 在 project_root (\`${dev.project_root}\`) 下做出代码改动,目标是让三件套(lint / typecheck / test)全部通过。`,
        `2. **不要**修改「禁止改动」列表里的文件;**不要**修改 .env / 密钥 / CI 配置;**不要**给评估器降级(如把失败测试 skip 掉)绕过门禁。`,
        `3. 完成后在 project_root 执行 \`git add -A && git commit -m "letsgoal(iter-${iteration}): <一句话总结>"\`。`,
        "4. 最后，在 JSON 摘要之前，请输出一段反思，标题为 `## Learnings`。内容是你这一轮踩了什么坑、下次该怎么做。自由格式，2-5 句话即可。",
        "5. 最后单独输出一行 JSON 摘要(便于解析),格式严格如下:",
        `\`\`\`json
{"changed_files": ["<相对路径>", ...], "commit_sha": "<完整 SHA>"}
\`\`\``,
        "6. 如果你判断这一轮无法解决(例如需求歧义、架构层面冲突),不要硬改。直接在 JSON 摘要里把 commit_sha 留空,并把决策理由写在 JSON 之前的文字里。",
      ].join("\n"),
    );
  }

  return blocks.join("\n\n");
}

// ============================================================================
// 子进程执行
// ============================================================================

interface SpawnClaudeResult {
  exit_code: number;
  duration_ms: number;
  timed_out: boolean;
}

function spawnExecutorProcess(
  prompt: string,
  cwd: string,
  logPath: string,
  timeoutMs: number,
  autonomyMode: AutonomyMode,
): Promise<SpawnClaudeResult> {
  return new Promise((res, rej) => {
    const cmd = process.env.LETSGOAL_EXECUTOR_CMD ?? DEFAULT_EXECUTOR_CMD;
    const permissionMode = claudePermissionMode(autonomyMode);
    const args = ["-p", prompt, "--permission-mode", permissionMode];

    const startedAt = Date.now();
    let timedOut = false;

    // 创建/清空日志文件,先把 prompt 写入(便于事后回溯)
    if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(
      logPath,
      `=== LetsGoal executor log ===\nstarted: ${new Date(startedAt).toISOString()}\ncmd: ${cmd}\ncwd: ${cwd}\n\n=== Prompt ===\n${prompt}\n\n=== Stdout/Stderr ===\n`,
      "utf-8",
    );

    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as Error;
      appendFileSync(logPath, `\n[executor] spawn 失败: ${err.message}\n`, "utf-8");
      rej(new Error(`无法启动 executor 进程 "${cmd}": ${err.message}`));
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      appendFileSync(logPath, `\n[executor] 超时 ${timeoutMs}ms,发送 SIGTERM\n`, "utf-8");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      appendFileSync(logPath, chunk.toString("utf-8"), "utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendFileSync(logPath, chunk.toString("utf-8"), "utf-8");
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const exitCode =
        typeof code === "number" ? code : signal !== null ? 128 : 1;
      appendFileSync(
        logPath,
        `\n[executor] exit_code=${exitCode} duration=${Date.now() - startedAt}ms timed_out=${timedOut}\n`,
        "utf-8",
      );
      res({ exit_code: exitCode, duration_ms: Date.now() - startedAt, timed_out: timedOut });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      appendFileSync(logPath, `\n[executor] 进程错误: ${err.message}\n`, "utf-8");
      rej(err);
    });
  });
}

// ============================================================================
// Git 状态收集
// ============================================================================

function gitTryOutput(args: string[], cwd: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function ensureGitRepo(projectRoot: string): void {
  const r = spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: projectRoot, encoding: "utf-8" },
  );
  if (r.status !== 0 || r.stdout.trim() !== "true") {
    throw new Error(
      `project_root (${projectRoot}) 不是 git 仓库;请先 \`git init\` 后再启动 self-loop`,
    );
  }
}

interface GitStateBefore {
  head_sha: string | null; // null 表示空仓库
}

function snapshotGitBefore(projectRoot: string): GitStateBefore {
  const sha = gitTryOutput(["rev-parse", "HEAD"], projectRoot);
  return { head_sha: sha };
}

interface GitStateAfter {
  head_sha: string | null;
  changed_files: string[];
}

/**
 * 比对 before/after,得到本轮 commit 与 changed_files。
 * 若 head_sha 没变(Claude 没 commit),返回空 changed_files。
 */
function snapshotGitAfter(
  projectRoot: string,
  before: GitStateBefore,
): GitStateAfter {
  const sha = gitTryOutput(["rev-parse", "HEAD"], projectRoot);
  if (sha === null) return { head_sha: null, changed_files: [] };
  if (before.head_sha === sha) {
    // Claude 没 commit;changed_files 反映工作区未提交修改
    const out = gitTryOutput(["status", "--porcelain"], projectRoot);
    if (out === null || out.length === 0) return { head_sha: sha, changed_files: [] };
    const files = out
      .split("\n")
      .map((l) => l.replace(/^.{2}\s+/, "").trim())
      .filter((l) => l.length > 0);
    return { head_sha: sha, changed_files: files };
  }
  // 有新 commit:对比 before..after
  const range =
    before.head_sha === null ? sha : `${before.head_sha}..${sha}`;
  const diff = gitTryOutput(["diff", "--name-only", range], projectRoot) ?? "";
  const files = diff
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { head_sha: sha, changed_files: files };
}

/**
 * 兜底:Claude 改了文件但忘了 commit。executor 帮它 commit 一次,
 * commit message 标记 fallback。
 */
function maybeFallbackCommit(
  projectRoot: string,
  iteration: number,
): { committed: boolean; sha?: string } {
  const status = gitTryOutput(["status", "--porcelain"], projectRoot);
  if (status === null || status.length === 0) {
    return { committed: false };
  }
  // 有未提交改动 → 兜底 commit
  spawnSync("git", ["add", "-A"], { cwd: projectRoot });
  const r = spawnSync(
    "git",
    [
      "commit",
      "-m",
      `letsgoal(iter-${iteration}): fallback commit by executor (claude 未自行 commit)`,
    ],
    { cwd: projectRoot, encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`兜底 commit 失败: ${r.stderr.trim()}`);
  }
  const sha = gitTryOutput(["rev-parse", "HEAD"], projectRoot);
  return { committed: true, sha: sha ?? undefined };
}

// ============================================================================
// 日志截尾 + Claude JSON 摘要解析
// ============================================================================

function readLogTail(logPath: string, n: number): string {
  if (!existsSync(logPath)) return "";
  // 简单读取整个文件再 tail —— 单轮日志通常 <10MB,够用
  const raw = readFileSync(logPath, "utf-8");
  const lines = raw.split(/\r?\n/);
  if (lines.length <= n) return raw;
  return lines.slice(lines.length - n).join("\n");
}

/**
 * 在日志末尾找 Claude 输出的 JSON 摘要。
 * 仅当形如 `{"changed_files": [...], "commit_sha": "..."}` 时解析成功。
 */
function parseClaudeSummary(
  log: string,
): { changed_files: string[]; commit_sha: string } | undefined {
  // 从末尾向前找最后一个匹配 JSON 块
  const re = /\{\s*"changed_files"\s*:\s*\[[\s\S]*?\]\s*,\s*"commit_sha"\s*:\s*"[^"]*"\s*\}/g;
  let lastMatch: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) lastMatch = m[0];
  if (lastMatch === undefined) return undefined;
  try {
    const parsed = JSON.parse(lastMatch) as {
      changed_files?: unknown;
      commit_sha?: unknown;
    };
    if (
      Array.isArray(parsed.changed_files) &&
      typeof parsed.commit_sha === "string"
    ) {
      const files: string[] = [];
      for (const f of parsed.changed_files) if (typeof f === "string") files.push(f);
      return { changed_files: files, commit_sha: parsed.commit_sha };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * 从 executor log 中提取 Claude 输出的 `## Learnings` 反思段落。
 *
 * 匹配规则:
 *   - 以 `## Learnings` 标题开头
 *   - 到下一个 `##` 标题、代码围栏(```) 或 JSON 摘要块 `{` 之前结束
 */
export function extractAiLearnings(log: string): string | undefined {
  const match = /##\s*Learnings\n([\s\S]*?)(?=\n##\s|\n```|\{\s*"changed_files")/.exec(log);
  if (match === null) return undefined;
  const text = match[1].trim();
  return text.length > 0 ? text : undefined;
}

// ============================================================================
// 顶层入口
// ============================================================================

export async function executeIteration(
  input: ExecutorInput,
): Promise<ExecutorOutput> {
  const dev = asDevPayload(input.task.direction_payload);
  if (!existsSync(dev.project_root)) {
    throw new Error(`project_root 不存在: ${dev.project_root}`);
  }
  ensureGitRepo(dev.project_root);

  const prompt = buildPrompt(input);

  const logPath = resolve(
    input.task.workspace_path,
    ".letsgoal",
    "iterations",
    `iter-${input.iteration}.log`,
  );

  const before = snapshotGitBefore(dev.project_root);

  const timeoutMs = parseTimeout(process.env.LETSGOAL_EXECUTE_TIMEOUT_MS) ??
    DEFAULT_EXECUTE_TIMEOUT_MS;

  const spawnRes = await spawnExecutorProcess(
    prompt,
    dev.project_root,
    logPath,
    timeoutMs,
    input.task.config.autonomy_mode ?? "standard",
  );

  // 即使 Claude 异常退出也要尝试收 git 状态
  const after = snapshotGitAfter(dev.project_root, before);

  // 兜底 commit:Claude 改了但没 commit
  let commitSha = before.head_sha === after.head_sha ? undefined : (after.head_sha ?? undefined);
  let changedFiles = after.changed_files;
  if (commitSha === undefined && changedFiles.length > 0) {
    const fb = maybeFallbackCommit(dev.project_root, input.iteration);
    if (fb.committed) {
      commitSha = fb.sha;
      // 重新计算 changed_files(本次 commit 实际改了什么)
      const range = before.head_sha === null
        ? (commitSha ?? "HEAD")
        : `${before.head_sha}..${commitSha ?? "HEAD"}`;
      const diff = gitTryOutput(["diff", "--name-only", range], dev.project_root) ?? "";
      changedFiles = diff
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    }
  }

  const logTail = readLogTail(logPath, LOG_TAIL_LINES);
  const claudeSummary = parseClaudeSummary(logTail);
  const aiLearnings = extractAiLearnings(logTail);

  return {
    changed_files: changedFiles,
    commit_sha: commitSha,
    log_path: logPath,
    log_tail: logTail,
    claude_exit_code: spawnRes.exit_code,
    duration_ms: spawnRes.duration_ms,
    claude_summary: claudeSummary,
    ai_learnings: aiLearnings,
  };
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return undefined;
}

// ============================================================================
// CLI 入口(便于单测,使用 mock executor)
// ============================================================================

async function main(): Promise<void> {
  const taskPath = process.argv[2];
  const iterationStr = process.argv[3] ?? "1";
  if (taskPath === undefined) {
    process.stderr.write(
      "用法: tsx executor.ts <path/to/task-state.json> [iteration]\n",
    );
    process.exit(2);
  }
  if (!existsSync(taskPath)) {
    process.stderr.write(`task 文件不存在: ${taskPath}\n`);
    process.exit(2);
  }
  const task = JSON.parse(readFileSync(taskPath, "utf-8")) as LoopTask;
  const iteration = Number(iterationStr);
  if (!Number.isFinite(iteration) || iteration < 1) {
    process.stderr.write(`非法 iteration: ${iterationStr}\n`);
    process.exit(2);
  }
  const out = await executeIteration({ task, iteration });
  process.stdout.write(
    JSON.stringify(
      {
        changed_files: out.changed_files,
        commit_sha: out.commit_sha,
        log_path: out.log_path,
        claude_exit_code: out.claude_exit_code,
        duration_ms: out.duration_ms,
        claude_summary: out.claude_summary,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(out.claude_exit_code === 0 ? 0 : 1);
}

const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`executor 失败: ${msg}\n`);
    process.exit(2);
  });
}
