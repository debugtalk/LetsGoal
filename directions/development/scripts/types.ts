/**
 * 开发调试方向特异类型定义
 *
 * 这些类型最终会作为 LoopTask.direction_payload 字段的具体值,
 * 在方向脚本内通过强类型断言读取。
 */

export type DevTaskType =
  | "feature" // 实现新功能
  | "bugfix" // 修复 bug
  | "refactor" // 重构
  | "skill_creation" // 创建新 skill(M1)
  | "skill_optimize"; // 优化现有 skill(M1)

export type ProjectLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "other";

/** 开发调试方向的三件套门禁名 */
export const DEV_GATE_NAMES = ["lint", "typecheck", "test"] as const;
export type DevGateName = typeof DEV_GATE_NAMES[number];

/**
 * 三件套命令配置。任一字段省略时由 evaluator 自动探测。
 */
export interface DevCommands {
  lint?: string;
  typecheck?: string;
  test?: string;
}

/**
 * 开发调试方向的任务输入。
 *
 * 注意:与 core/types.ts 中的 LoopTask 是两回事。
 * LoopTask 是循环引擎的状态对象;DevTaskRequest 是用户输入的方向特异部分。
 * parse_request 把 Markdown 解析后,把 DevTaskRequest 塞进 LoopTask.direction_payload。
 */
export interface DevTaskRequest {
  project_root: string; // 被开发项目的根目录(绝对路径)
  language?: ProjectLanguage; // 不给则自动探测
  commands?: DevCommands; // 不给则按发现策略 fallback
  task_type?: DevTaskType; // 默认 feature
  bug_repro?: string; // task_type=bugfix 时必填
  coverage_target?: number; // M2 启用,M0/M1 忽略
  eval_suite?: { version: string; files: string[] }; // 评测集版本冻结
}

/**
 * 单个评估命令的运行结果。
 */
export interface EvaluatorRunResult {
  command: string;
  exit_code: number;
  passed: boolean;
  duration_ms: number;
  stdout_tail: string; // 末尾 100 行
  stderr_tail: string; // 末尾 100 行
  parsed_failures?: string[]; // M1 引入,M0 留空
}

/**
 * 评估器整体输出。任一字段缺失表示该门禁未发现命令、被 skip。
 */
export interface EvaluatorResult {
  lint?: EvaluatorRunResult;
  typecheck?: EvaluatorRunResult;
  test?: EvaluatorRunResult;
}

/**
 * 类型守卫:从 LoopTask.direction_payload 提取 DevTaskRequest。
 */
export function asDevPayload(payload: Record<string, unknown>): DevTaskRequest {
  if (typeof payload.project_root !== "string" || payload.project_root.length === 0) {
    throw new Error("DevTaskRequest.project_root 缺失或非字符串");
  }
  return payload as unknown as DevTaskRequest;
}
