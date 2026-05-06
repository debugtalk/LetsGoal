/**
 * 渐进式自主模式
 *
 * 根据 AutonomyMode(strict / standard / autonomous)控制暂停行为、
 * Claude 权限模式、汇报粒度，以及从 workspace 恢复中断任务的状态。
 */

import type {
  AutonomyMode,
  Diagnosis,
  EvaluationResult,
  IterationResult,
  LoopTask,
} from "./types.js";
import type { NotificationEvent } from "./notifier.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// 导出接口
// ============================================================================

export interface ResumedState {
  task: LoopTask;
  iterations: IterationResult[];
  prevEvaluation: EvaluationResult | undefined;
  prevDiagnosis: Diagnosis | undefined;
}

// ============================================================================
// 自主模式决策函数
// ============================================================================

export function shouldPauseBeforeExecution(mode: AutonomyMode): boolean {
  return mode === "strict";
}

export function shouldPauseOnEscalation(mode: AutonomyMode): boolean {
  return mode === "strict";
}

export function claudePermissionMode(mode: AutonomyMode): "default" | "bypassPermissions" {
  return mode === "strict" ? "default" : "bypassPermissions";
}

export function reportVerbosity(
  mode: AutonomyMode,
): "full" | "minimal" | "silent" {
  return mode === "autonomous" ? "minimal" : "full";
}

/**
 * 判断当前决策是否需要通知。
 *
 * - strict 模式：所有事件都通知
 * - standard 模式：escalation / consecutive_failures / task_completed 通知
 * - autonomous 模式：仅 escalation / task_completed 通知
 */
export function shouldNotifyOnDecision(
  autonomyMode: AutonomyMode,
  event: NotificationEvent,
): boolean {
  if (autonomyMode === "strict") return true;

  if (autonomyMode === "standard") {
    return event !== "awaiting_human";
  }

  // autonomous
  return event === "escalation" || event === "task_completed";
}

// ============================================================================
// 状态恢复
// ============================================================================

export function loadResumedState(workspacePath: string): ResumedState | null {
  const lgDir = resolve(workspacePath, ".letsgoal");
  const statePath = resolve(lgDir, "task-state.json");

  let raw: LoopTask;
  try {
    raw = JSON.parse(readFileSync(statePath, "utf-8")) as LoopTask;
  } catch (e: unknown) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw e;
  }

  if (raw.status !== "awaiting_human" && raw.status !== "paused" && raw.status !== "awaiting_review") return null;

  const task: LoopTask = { ...raw, status: "running" };

  const iterationsPath = resolve(lgDir, "iterations.jsonl");
  const iterations: IterationResult[] = [];

  try {
    const content = readFileSync(iterationsPath, "utf-8").trim();
    if (content.length > 0) {
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          iterations.push(JSON.parse(trimmed) as IterationResult);
        }
      }
    }
  } catch (e: unknown) {
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) {
      throw e;
    }
  }

  const lastIteration =
    iterations.length > 0 ? iterations[iterations.length - 1] : undefined;

  return {
    task,
    iterations,
    prevEvaluation: lastIteration?.evaluation,
    prevDiagnosis: lastIteration?.diagnosis,
  };
}
