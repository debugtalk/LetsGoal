/**
 * 开发调试方向 DirectionAdapter 实现
 *
 * 把方向内部的 executor / evaluator / diagnose 串成 core 期望的接口。
 * core/self_loop.ts 通过 `--direction development` 加载本 adapter。
 */

import type {
  DirectionAdapter,
  EvaluationResult,
  ExecuteContext,
  Diagnosis,
  HardGateResult,
  IterationResult,
  LoopTask,
} from "../../../core/scripts/types.js";

import {
  evaluateTask,
} from "./evaluator.js";
import { executeIteration } from "./executor.js";
import { diagnoseDevelopmentFailure } from "./diagnose.js";
import { ESCALATE_CATEGORIES, isDiagnosisCategory } from "./classifier.js";
import { asDevPayload, DEV_GATE_NAMES, type EvaluatorResult, type EvaluatorRunResult } from "./types.js";
import { freezeEvalSuite, verifyEvalSuite, type EvalSuiteRecord } from "./eval_suite.js";

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// 跨阶段状态(单实例,M0 不考虑并发)
// ============================================================================

/**
 * evaluate 阶段拿到的原始 EvaluatorResult 缓存,
 * 在同一轮的 diagnose 阶段被读出以获取 stderr_tail 等细节。
 */
const evaluatorResultByIter = new Map<number, EvaluatorResult>();

// ============================================================================
// EvaluatorResult → EvaluationResult 转换
// ============================================================================

function toHardGate(
  gate: string,
  r: EvaluatorRunResult | undefined,
  required: boolean,
): HardGateResult | null {
  if (r === undefined) {
    if (!required) return null; // 既不需要也没跑 → 不计入
    return {
      gate,
      passed: false,
      detail: "命令未发现(skip),但属于硬门禁",
    };
  }
  if (r.passed) {
    return { gate, passed: true };
  }
  // 非要求门禁失败 → 不计入 hard_gates（仅作为参考信息，不影响 pass/fail）
  if (!required) return null;
  // 要求门禁失败:取 stderr_tail 第一行作为 detail
  const head = (r.stderr_tail.trim() || r.stdout_tail.trim()).split(/\r?\n/)[0] ?? "";
  return {
    gate,
    passed: false,
    detail: `exit_code=${r.exit_code}${head.length > 0 ? `: ${head}` : ""}`,
  };
}

function evaluatorResultToEvaluation(
  task: LoopTask,
  raw: EvaluatorResult,
): EvaluationResult {
  const requiredGates = new Set(task.success_criteria.hard_gates);
  const hardGates: HardGateResult[] = [];

  // 三件套门禁
  for (const name of DEV_GATE_NAMES) {
    const isRequired = requiredGates.has(name);
    const r = raw[name];
    const gate = toHardGate(name, r, isRequired);
    if (gate !== null) hardGates.push(gate);
  }

  // Skill 专用门禁（skill_syntax / skill_eval）
  const skillGates: [string, EvaluatorRunResult | undefined][] = [
    ["skill_syntax", raw.skill_syntax],
    ["skill_eval", raw.skill_eval],
  ];
  for (const [name, r] of skillGates) {
    const isRequired = requiredGates.has(name);
    const gate = toHardGate(name, r, isRequired);
    if (gate !== null) hardGates.push(gate);
  }

  // 检查 success_criteria 中是否还有未覆盖的门禁
  const knownGates = new Set([
    ...DEV_GATE_NAMES,
    "skill_syntax",
    "skill_eval",
  ]);
  for (const required of requiredGates) {
    if (!knownGates.has(required)) {
      hardGates.push({
        gate: required,
        passed: false,
        detail: "未知门禁",
      });
    }
  }

  const allPassed = hardGates.every((g) => g.passed);
  const weightedScore = allPassed ? 1.0 : 0.0;

  return {
    hard_gates: hardGates,
    hard_gates_all_passed: allPassed,
    weighted_score: weightedScore,
  };
}

// ============================================================================
// adapter 五阶段实现
// ============================================================================

async function plan(task: LoopTask): Promise<LoopTask> {
  // M0:parse_request 已在 self_loop 入口处完成,plan 只做 workspace 准备
  const dev = asDevPayload(task.direction_payload);

  if (!existsSync(dev.project_root)) {
    throw new Error(
      `project_root 不存在: ${dev.project_root};plan 阶段失败`,
    );
  }

  // 校验 git 仓库
  const r = spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: dev.project_root, encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(
      `project_root (${dev.project_root}) 不是 git 仓库;请先 \`git init\``,
    );
  }

  // 准备 workspace 目录（self_loop 已创建 .letsgoal/，这里只确保 iterations/ 存在）
  mkdirSync(resolve(task.workspace_path, ".letsgoal", "iterations"), { recursive: true });

  // 冻结评测集
  if (dev.eval_suite) {
    const record = await freezeEvalSuite(dev.project_root, dev.eval_suite);
    writeFileSync(
      resolve(task.workspace_path, ".letsgoal", "eval-suite.json"),
      JSON.stringify(record, null, 2) + "\n",
      "utf-8",
    );
  }

  return task;
}

async function execute(
  task: LoopTask,
  iteration: number,
  context: ExecuteContext,
): Promise<{ changed_files: string[]; commit_sha?: string }> {
  const out = await executeIteration({
    task,
    iteration,
    prevEvaluation: extractRawEvaluatorResult(context, iteration),
    prevDiagnosis: context.prev_diagnosis,
  });
  return {
    changed_files: out.changed_files,
    commit_sha: out.commit_sha,
  };
}

/**
 * 从 ExecuteContext 中拿"上一轮的原始 EvaluatorResult"。
 *
 * EvaluationResult 是共享类型(对所有方向通用),不含 stderr_tail 等细节。
 * Executor 需要 stderr_tail 来注入 prompt,所以从 evaluator 缓存里取原始结果。
 */
function extractRawEvaluatorResult(
  _context: ExecuteContext,
  iteration: number,
): EvaluatorResult | undefined {
  // 上一轮是 iteration - 1
  if (iteration <= 1) return undefined;
  return evaluatorResultByIter.get(iteration - 1);
}

async function evaluate(
  task: LoopTask,
  iteration: number,
): Promise<EvaluationResult> {
  // 校验评测集冻结状态
  const evalSuitePath = resolve(task.workspace_path, ".letsgoal", "eval-suite.json");
  if (existsSync(evalSuitePath)) {
    const dev = asDevPayload(task.direction_payload);
    if (dev.eval_suite) {
      const record = JSON.parse(readFileSync(evalSuitePath, "utf-8")) as EvalSuiteRecord;
      if (record.frozen) {
        const valid = await verifyEvalSuite(dev.project_root, record, dev.eval_suite);
        if (!valid) {
          throw new Error("评测集校验失败：自循环开始后评测标准文件发生了变化");
        }
      }
    }
  }

  const raw = await evaluateTask(task);
  evaluatorResultByIter.set(iteration, raw);
  // 只保留最近两轮的结果（当轮 + 上一轮）
  for (const key of [...evaluatorResultByIter.keys()]) {
    if (key < iteration - 1) evaluatorResultByIter.delete(key);
  }
  return evaluatorResultToEvaluation(task, raw);
}

async function diagnose(
  _task: LoopTask,
  iteration: number,
  evaluation: EvaluationResult,
): Promise<Diagnosis> {
  const raw = evaluatorResultByIter.get(iteration);
  return diagnoseDevelopmentFailure(evaluation, raw);
}

async function report(_task: LoopTask, iter: IterationResult): Promise<string> {
  const passOrFail = iter.status === "passed" ? "✅ PASS" : "❌ FAIL";
  const gates = iter.evaluation.hard_gates
    .map((g) => `${g.gate}=${g.passed ? "✓" : "✗"}`)
    .join(" ");
  const sha = iter.commit_sha ? ` [${iter.commit_sha.slice(0, 7)}]` : "";
  const cat = iter.diagnosis?.category;
  const categoryTag = cat ? ` [${cat}]` : "";
  const escalateTag =
    cat && isDiagnosisCategory(cat) && ESCALATE_CATEGORIES.has(cat) ? " ⚠️ESCALATE" : "";
  const reason =
    iter.status === "failed" && iter.diagnosis
      ? `\n  └─ ${iter.diagnosis.reason}`
      : "";
  return `iter ${iter.iteration}: ${passOrFail}${categoryTag}${escalateTag} ${gates}${sha}${reason}`;
}

// ============================================================================
// 导出 adapter
// ============================================================================

export const developmentAdapter: DirectionAdapter = {
  direction: "development",
  plan,
  execute,
  evaluate,
  diagnose,
  report,
};

/** 仅供测试:清空跨轮缓存 */
export function _resetAdapterState(): void {
  evaluatorResultByIter.clear();
}
