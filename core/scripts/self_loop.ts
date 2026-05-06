/**
 * LetsGoal 自循环主入口
 *
 * 五阶段闭环:Plan → Execute → Evaluate → Repair(Diagnose) → Report
 * 直到任一终态:
 *   - hard_gates_all_passed && weighted_score >= min_score → status=passed
 *   - current_iteration >= max_iterations → status=failed
 *
 * 状态持久化:
 *   - <workspace>/.letsgoal/task-state.json   每轮更新
 *   - <workspace>/.letsgoal/iterations.jsonl  每轮追加 IterationResult
 *   - <workspace>/.letsgoal/iterations/iter-N.log  每轮 executor 子进程完整日志
 *   - <workspace>/.letsgoal/final-report.md   终态汇报
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  type DirectionAdapter,
  type Diagnosis,
  type EvaluationResult,
  type IterationResult,
  type IterationStatus,
  type LoopDirection,
  type LoopTask,
  type NextAction,
  type ReviewOutput,
} from "./types.js";

import { parseMarkdownTask } from "./parse_request.js";
import {
  shouldPauseBeforeExecution,
  shouldPauseOnEscalation,
  loadResumedState,
  shouldNotifyOnDecision,
} from "./autonomy.js";
import { reviewRequirement, generateReviewMarkdown } from "./review.js";
import { createDoc, appendDoc } from "./feishu.js";
import {
  shouldNotify,
  sendNotification,
  extractNotificationConfig,
  type NotificationConfig,
  type NotificationPayload,
  type NotificationEvent,
} from "./notifier.js";

// ============================================================================
// CLI 参数
// ============================================================================

interface CliArgs {
  direction: LoopDirection;
  input: string;
  workspace: string;
  resume?: boolean;
  dryRun?: boolean;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      direction: { type: "string", short: "d" },
      input: { type: "string", short: "i" },
      workspace: { type: "string", short: "w" },
      resume: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (!values.input) throw new Error("缺少 --input <markdown 路径>");
  if (!values.workspace) throw new Error("缺少 --workspace <工作目录>");

  const direction = (values.direction ?? "development") as LoopDirection;
  if (direction !== "development") {
    throw new Error(`M0 暂只支持 --direction development,收到: ${direction}`);
  }

  return {
    direction,
    input: resolve(values.input),
    workspace: resolve(values.workspace),
    resume: values.resume === true,
    dryRun: values["dry-run"] === true,
  };
}

// ============================================================================
// adapter 加载
// ============================================================================

async function loadAdapter(direction: LoopDirection): Promise<DirectionAdapter> {
  if (direction === "development") {
    const mod = await import(
      "../../directions/development/scripts/adapter.js"
    );
    return mod.developmentAdapter as DirectionAdapter;
  }
  throw new Error(`未实现的方向: ${direction}`);
}

// ============================================================================
// 状态持久化
// ============================================================================

function lgDir(task: LoopTask): string {
  return resolve(task.workspace_path, ".letsgoal");
}

function ensureLgDir(task: LoopTask): void {
  const d = lgDir(task);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function saveTaskState(task: LoopTask): void {
  ensureLgDir(task);
  const path = resolve(lgDir(task), "task-state.json");
  writeFileSync(path, JSON.stringify(task, null, 2) + "\n", "utf-8");
}

function appendIterationsJsonl(task: LoopTask, iter: IterationResult): void {
  ensureLgDir(task);
  const path = resolve(lgDir(task), "iterations.jsonl");
  appendFileSync(path, JSON.stringify(iter) + "\n", "utf-8");
}

function writeFinalReport(
  task: LoopTask,
  iterations: IterationResult[],
): string {
  const path = resolve(lgDir(task), "final-report.md");
  const status = task.status;
  const head = [
    `# LetsGoal 终态报告`,
    ``,
    `- 任务 ID: \`${task.task_id}\``,
    `- 目标: ${task.goal}`,
    `- 方向: ${task.direction}`,
    `- 终态: **${status}**`,
    `- 总轮次: ${task.current_iteration} / ${task.config.max_iterations}`,
    `- 最佳分数: ${task.best_score} (轮次 ${task.best_iteration})`,
    `- 创建时间: ${task.created_at}`,
    `- 更新时间: ${task.updated_at}`,
    ``,
    `## 每轮结果`,
    ``,
  ].join("\n");

  const rows = iterations
    .map((it) => {
      const sha = it.commit_sha ? `\`${it.commit_sha.slice(0, 7)}\`` : "—";
      const gateText = it.evaluation.hard_gates
        .map((g) => `${g.gate}=${g.passed ? "✓" : "✗"}`)
        .join(" ");
      const reason = it.diagnosis ? `<br>${escapeMd(it.diagnosis.reason)}` : "";
      return `| ${it.iteration} | ${it.status} | ${gateText} | ${sha} | ${escapeMd(it.changed_files.join(", "))}${reason} |`;
    })
    .join("\n");

  const table = [
    `| 轮次 | 状态 | 硬门禁 | commit | changed_files / 归因 |`,
    `|---|---|---|---|---|`,
    rows,
  ].join("\n");

  const body = head + table + "\n";
  writeFileSync(path, body, "utf-8");
  return path;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatIterationMarkdown(iter: IterationResult): string {
  const gates = iter.evaluation.hard_gates
    .map((g) => `${g.gate} ${g.passed ? "✅" : "❌"}`)
    .join(" ");
  const score = iter.evaluation.weighted_score.toFixed(2);
  const diag = iter.diagnosis
    ? `${iter.diagnosis.category ?? "unknown"} — ${iter.diagnosis.reason}`
    : "—";
  const conclusion = iter.status === "passed"
    ? "全部硬门禁通过，加权软分达标"
    : (iter.diagnosis?.reason ?? "未通过验收");

  return [
    "",
    `## 迭代 ${iter.iteration} — ${iter.ended_at}`,
    "",
    `**状态**：${iter.status === "passed" ? "通过" : "失败"}`,
    `**硬门禁**：${gates}`,
    `**软分**：${score}`,
    `**诊断**：${diag}`,
    `**关键结论**：${conclusion}`,
    "",
    "---",
  ].join("\n");
}

/** 暂停循环等待人工，返回 awaiting_human 退出码 */
function pauseForHuman(task: LoopTask, message: string): number {
  task.status = "awaiting_human";
  task.updated_at = new Date().toISOString();
  saveTaskState(task);
  process.stdout.write(`[self-loop] ${message}\n`);
  return 10;
}

// ============================================================================
// 通知辅助（合并 autonomy + config 双重判断）
// ============================================================================

function tryNotify(
  event: NotificationEvent,
  payload: Omit<NotificationPayload, "event">,
  autonomyMode: string,
  notifyConfig: NotificationConfig,
  consecutiveCount?: number,
): void {
  if (!shouldNotifyOnDecision(autonomyMode as "strict" | "standard" | "autonomous", event)) return;
  if (!shouldNotify(event, notifyConfig, consecutiveCount)) return;
  sendNotification({ ...payload, event }, notifyConfig).catch(() => {});
}

// ============================================================================
// Review 阶段(M2.6)
// ============================================================================

async function runReviewPhase(task: LoopTask): Promise<LoopTask> {
  const rawInput = task.raw_requirement ?? task.goal;
  process.stdout.write(`[self-loop] review 阶段: 结构化需求...\n`);

  let review: ReviewOutput;
  try {
    review = await reviewRequirement(rawInput);
  } catch (e) {
    process.stderr.write(
      `[self-loop] review 需求结构化失败: ${(e as Error).message}\n`,
    );
    return task;
  }

  const markdown = generateReviewMarkdown(review);
  const notifyConfig = extractNotificationConfig(task.config);

  // 飞书文档创建（notifyConfig.channel 已考虑 lark-cli 可用性降级）
  if (notifyConfig.channel === "feishu" || notifyConfig.channel === "both") {
    try {
      const docRef = createDoc(
        `需求 Review: ${task.goal.slice(0, 50)}`,
        markdown,
      );
      task.config.feishu_doc_url = docRef.doc_url;
      task.config.feishu_doc_id = docRef.doc_id;
      process.stdout.write(
        `[self-loop] 飞书文档已创建: ${docRef.doc_url}\n`,
      );
    } catch (e) {
      process.stderr.write(
        `[self-loop] 飞书文档创建失败: ${(e as Error).message}\n`,
      );
    }
  }

  process.stdout.write(`\n${markdown}\n\n`);

  if (task.config.feishu_doc_url) {
    process.stdout.write(
      `[self-loop] 请在飞书文档中确认需求: ${task.config.feishu_doc_url}\n`,
    );
  }
  process.stdout.write(
    `[self-loop] 需求已结构化,等待确认后 --resume 继续\n`,
  );

  task.status = "awaiting_review";
  task.updated_at = new Date().toISOString();
  saveTaskState(task);

  return task;
}

// ============================================================================
// 主循环
// ============================================================================

async function runSelfLoop(args: CliArgs): Promise<number> {
  let task: LoopTask;
  let iterations: IterationResult[] = [];
  let prevEvaluation: EvaluationResult | undefined;
  let prevDiagnosis: Diagnosis | undefined;

  if (args.resume) {
    const state = loadResumedState(args.workspace);
    if (state === null) {
      throw new Error(`--resume 失败: ${args.workspace} 中无可恢复的任务状态`);
    }
    task = state.task;
    iterations = state.iterations;
    prevEvaluation = state.prevEvaluation;
    prevDiagnosis = state.prevDiagnosis;
    process.stdout.write(
      `[self-loop] resume task_id=${task.task_id} from iter ${task.current_iteration}\n`,
    );
  } else {
    if (!existsSync(args.input)) {
      throw new Error(`输入文件不存在: ${args.input}`);
    }
    const md = readFileSync(args.input, "utf-8");
    task = parseMarkdownTask(md, {
      requestPath: args.input,
      workspacePath: args.workspace,
      direction: args.direction,
    });
  }

  ensureLgDir(task);
  saveTaskState(task);

  // review 阶段
  if (!args.resume && task.raw_requirement) {
    task = await runReviewPhase(task);
    if (task.status === "awaiting_review") {
      return 10;
    }
  } else if (args.resume && task.status === "awaiting_review") {
    process.stdout.write(
      `[self-loop] resume from awaiting_review, task_id=${task.task_id}\n`,
    );
    task.status = "draft";
    task.updated_at = new Date().toISOString();
    saveTaskState(task);
  }

  const adapter = await loadAdapter(args.direction);

  if (!args.resume) {
    task = await adapter.plan(task);
    saveTaskState(task);
  }

  if (args.dryRun === true) {
    process.stdout.write(`[self-loop] dry-run 完成,task_id=${task.task_id}\n`);
    return 0;
  }

  task.status = "running";
  saveTaskState(task);

  process.stdout.write(
    `[self-loop] 启动 task_id=${task.task_id} direction=${task.direction} max=${task.config.max_iterations}\n`,
  );

  const startIter = args.resume ? task.current_iteration + 1 : 1;
  const autonomyMode = task.config.autonomy_mode ?? "standard";
  const notifyConfig = extractNotificationConfig(task.config);

  let consecutiveFailureCategory: string | undefined;
  let consecutiveFailureCount = 0;

  for (let iter = startIter; iter <= task.config.max_iterations; iter++) {
    if (shouldPauseBeforeExecution(autonomyMode)) {
      tryNotify("awaiting_human", {
        task_id: task.task_id,
        iteration: iter,
        message: `strict 模式: 第 ${iter} 轮执行前暂停`,
      }, autonomyMode, notifyConfig);
      return pauseForHuman(task, `strict 模式: 第 ${iter} 轮执行前暂停，等待人工确认后 --resume 继续`);
    }

    const startedAt = new Date().toISOString();
    let exec: { changed_files: string[]; commit_sha?: string } = {
      changed_files: [],
      commit_sha: undefined,
    };
    let evaluation: EvaluationResult = {
      hard_gates: [],
      hard_gates_all_passed: false,
      weighted_score: 0,
    };
    let diagnosis: Diagnosis | undefined;
    let stageError: string | undefined;

    try {
      exec = await adapter.execute(task, iter, {
        prev_evaluation: prevEvaluation,
        prev_diagnosis: prevDiagnosis,
        history: iterations,
      });
    } catch (e) {
      stageError = `execute 异常: ${(e as Error).message}`;
      process.stderr.write(`[self-loop iter-${iter}] ${stageError}\n`);
    }

    if (stageError === undefined) {
      try {
        evaluation = await adapter.evaluate(task, iter);
      } catch (e) {
        stageError = `evaluate 异常: ${(e as Error).message}`;
        process.stderr.write(`[self-loop iter-${iter}] ${stageError}\n`);
      }
    }

    const passed =
      stageError === undefined &&
      evaluation.hard_gates_all_passed &&
      evaluation.weighted_score >= task.config.min_score;
    const status: IterationStatus = passed ? "passed" : "failed";

    if (!passed) {
      try {
        diagnosis = await adapter.diagnose(task, iter, evaluation, iterations);
        if (stageError !== undefined) {
          diagnosis = {
            reason: `${stageError}; ${diagnosis.reason}`,
            evidence: diagnosis.evidence,
          };
        }
      } catch (e) {
        diagnosis = {
          reason: `diagnose 异常: ${(e as Error).message}${stageError ? `; ${stageError}` : ""}`,
        };
      }
    }

    let nextAction: NextAction;
    if (passed) nextAction = "done";
    else if (iter >= task.config.max_iterations) nextAction = "escalate";
    else if (shouldPauseOnEscalation(autonomyMode) && diagnosis?.category && adapter.escalate_categories.has(diagnosis.category)) {
      tryNotify("escalation", {
        task_id: task.task_id,
        iteration: iter,
        message: `归因升级: ${diagnosis.category}`,
        detail: diagnosis.reason,
      }, autonomyMode, notifyConfig);
      return pauseForHuman(task, `strict 模式: 归因为 ${diagnosis.category}，等待人工确认后 --resume 继续`);
    }
    else nextAction = "retry";

    // 非暂停但有升级分类
    if (!passed && diagnosis?.category && adapter.escalate_categories.has(diagnosis.category) && nextAction === "retry") {
      tryNotify("escalation", {
        task_id: task.task_id,
        iteration: iter,
        message: `归因升级（继续重试）: ${diagnosis.category}`,
        detail: diagnosis.reason,
      }, autonomyMode, notifyConfig);
    }

    // 连续同类失败跟踪
    if (!passed && diagnosis?.category) {
      if (diagnosis.category === consecutiveFailureCategory) {
        consecutiveFailureCount++;
      } else {
        consecutiveFailureCategory = diagnosis.category;
        consecutiveFailureCount = 1;
      }

      if (consecutiveFailureCount >= (notifyConfig.consecutive_failure_threshold)) {
        tryNotify("consecutive_failures", {
          task_id: task.task_id,
          iteration: iter,
          message: `同一分类连续失败 ${consecutiveFailureCount} 次: ${consecutiveFailureCategory}`,
          detail: diagnosis.reason,
        }, autonomyMode, notifyConfig, consecutiveFailureCount);
      }
    } else if (passed) {
      consecutiveFailureCategory = undefined;
      consecutiveFailureCount = 0;
    }

    const iterResult: IterationResult = {
      iteration: iter,
      status,
      evaluation,
      diagnosis,
      changed_files: exec.changed_files,
      commit_sha: exec.commit_sha,
      next_action: nextAction,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    };

    iterations.push(iterResult);
    appendIterationsJsonl(task, iterResult);

    task.current_iteration = iter;
    task.updated_at = new Date().toISOString();
    if (evaluation.weighted_score > task.best_score) {
      task.best_score = evaluation.weighted_score;
      task.best_iteration = iter;
    }
    saveTaskState(task);

    try {
      const summary = await adapter.report(task, iterResult);
      process.stdout.write(`[self-loop] ${summary}\n`);
    } catch (e) {
      process.stderr.write(`[self-loop] report 异常(忽略): ${(e as Error).message}\n`);
    }

    if (task.config.feishu_doc_id) {
      try {
        const iterMd = formatIterationMarkdown(iterResult);
        appendDoc(task.config.feishu_doc_id, iterMd);
      } catch (e) {
        process.stderr.write(
          `[self-loop] 飞书迭代记录追加失败(忽略): ${(e as Error).message}\n`,
        );
      }
    }

    if (passed) {
      task.status = "passed";
      saveTaskState(task);
      tryNotify("task_completed", {
        task_id: task.task_id,
        iteration: iter,
        message: `任务通过验收，共 ${iter} 轮迭代`,
        detail: `最佳分数: ${task.best_score}`,
      }, autonomyMode, notifyConfig);
      break;
    }

    prevEvaluation = evaluation;
    prevDiagnosis = diagnosis;
  }

  if (task.status !== "passed") {
    task.status = "failed";
    saveTaskState(task);
    tryNotify("task_completed", {
      task_id: task.task_id,
      iteration: task.current_iteration,
      message: `任务失败，已达最大迭代 ${task.config.max_iterations} 轮`,
      detail: `最佳分数: ${task.best_score}（轮次 ${task.best_iteration}）`,
    }, autonomyMode, notifyConfig);
  }

  const reportPath = writeFinalReport(task, iterations);
  process.stdout.write(`[self-loop] 终态: ${task.status}; 报告: ${reportPath}\n`);

  return task.status === "passed" ? 0 : 1;
}

// ============================================================================
// CLI 入口
// ============================================================================

async function main(): Promise<void> {
  const args = parseCliArgs();
  const exitCode = await runSelfLoop(args);
  process.exit(exitCode);
}

const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`self-loop 失败: ${msg}\n`);
    process.exit(2);
  });
}
