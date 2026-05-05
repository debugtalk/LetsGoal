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
import { existsSync, readFileSync } from "node:fs";
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

export function claudePermissionMode(mode: AutonomyMode): string {
  return mode === "strict" ? "default" : "bypassPermissions";
}

export function reportVerbosity(
  mode: AutonomyMode,
): "full" | "minimal" | "silent" {
  return mode === "autonomous" ? "minimal" : "full";
}

// ============================================================================
// 状态恢复
// ============================================================================

export function loadResumedState(workspacePath: string): ResumedState | null {
  const lgDir = resolve(workspacePath, ".letsgoal");
  const statePath = resolve(lgDir, "task-state.json");

  if (!existsSync(statePath)) return null;

  const raw = JSON.parse(readFileSync(statePath, "utf-8")) as LoopTask;

  if (raw.status !== "awaiting_human" && raw.status !== "paused") return null;

  const task: LoopTask = { ...raw, status: "running" };

  const iterationsPath = resolve(lgDir, "iterations.jsonl");
  const iterations: IterationResult[] = [];

  if (existsSync(iterationsPath)) {
    const content = readFileSync(iterationsPath, "utf-8").trim();
    if (content.length > 0) {
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          iterations.push(JSON.parse(trimmed) as IterationResult);
        }
      }
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
