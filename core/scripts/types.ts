/**
 * LetsGoal 共享类型定义
 *
 * 本文件定义三个方向(开发调试 / 数据采集 / 模型调优)共享的核心契约。
 * 方向特异字段在各 directions/<dir>/scripts/types.ts 中扩展,不要堆放到这里。
 *
 * 命名约定:字段使用 snake_case,与 DataClaw 已有协议保持一致。
 */

// ============================================================================
// 枚举与方向
// ============================================================================

export type LoopDirection = "development" | "data-collection" | "model-tuning";

export type TaskStatus =
  | "draft" // 已创建,未启动
  | "running" // 正在循环
  | "awaiting_human" // 等待人工决策
  | "passed" // 通过验收
  | "failed" // 终止失败
  | "paused" // 用户暂停
  | "stopped"; // 用户停止

export type IterationStatus = "running" | "passed" | "failed";

export type NextAction = "retry" | "escalate" | "done";

// 渐进式自主模式(M2 启用,M0/M1 默认 standard)
export type AutonomyMode = "strict" | "standard" | "autonomous";

// ============================================================================
// 评估
// ============================================================================

/**
 * 单个硬门禁的评估结果。
 *
 * 硬门禁是"必过项",任何一项失败本轮都不通过,即使加权软分高也不行。
 */
export interface HardGateResult {
  gate: string; // 门禁标识(例:"lint" / "typecheck" / "test_pass" / "rank_continuity")
  passed: boolean;
  detail?: string; // 失败时的简短说明
}

/**
 * 加权软分单项(M1 引入,M0 暂不使用)。
 *
 * 用于在多个候选版本之间排序。score ∈ [0,1],weight ∈ [0,1]。
 */
export interface SoftScoreItem {
  name: string;
  score: number;
  weight: number;
}

/**
 * 单轮评估的整体结果。
 */
export interface EvaluationResult {
  hard_gates: HardGateResult[];
  hard_gates_all_passed: boolean;
  soft_scores?: SoftScoreItem[]; // M0 可省略
  weighted_score: number; // M0 可简化为"硬门禁通过则 1.0,否则 0.0"
}

// ============================================================================
// 失败归因
// ============================================================================

/**
 * 失败归因。M0 仅 reason 自由文本;M1 引入 category 分类。
 *
 * category 在各 direction 内部定义具体枚举(开发调试 9 类、数据采集 11 类等),
 * 共享类型只约束为 string,避免 core 感知方向。
 */
export interface Diagnosis {
  category?: string; // 方向特异分类(M1 启用)
  reason: string; // 自由文本说明
  evidence?: string[]; // 辅助证据(stderr 摘要、failed test 名等)
}

// ============================================================================
// 产物
// ============================================================================

/**
 * 单个产物记录(M1 引入)。M0 用 changed_files + commit_sha 替代。
 */
export interface Artifact {
  type: string; // commit | log | report | screenshot | json | ...
  path: string; // 本地路径或 URL
  description?: string;
}

// ============================================================================
// 单轮迭代
// ============================================================================

/**
 * 单轮迭代结果。每轮一条记录。
 */
export interface IterationResult {
  iteration: number;
  status: IterationStatus;
  evaluation: EvaluationResult;
  diagnosis?: Diagnosis; // 仅当 status === "failed" 时有值
  changed_files: string[];
  commit_sha?: string; // 使用 Git 状态源时填入
  artifacts?: Artifact[]; // M1 引入
  next_action: NextAction;
  started_at: string; // ISO 8601
  ended_at: string;
}

// ============================================================================
// 任务定义
// ============================================================================

/**
 * 成功标准。
 */
export interface SuccessCriteria {
  hard_gates: string[]; // 必过项的标识列表
  min_score: number; // 默认 0.92
}

/**
 * 循环配置。
 */
export interface LoopConfig {
  max_iterations: number; // 默认 10
  min_score: number; // 默认 0.92
  autonomy_mode?: AutonomyMode; // M2 启用,M0/M1 默认 standard
}

/**
 * 任务顶层定义。每次自循环对应一个 LoopTask。
 *
 * 方向特异字段(如 DevTaskRequest 中的项目语言、测试命令)放在 direction_payload。
 * 这是为了让 core 不感知方向,同时方向脚本可以通过强类型断言读取自己的字段。
 */
export interface LoopTask {
  task_id: string;
  direction: LoopDirection;
  goal: string;
  success_criteria: SuccessCriteria;
  constraints: string[]; // 自然语言约束清单
  forbidden_changes?: string[]; // 禁止修改的文件/路径
  config: LoopConfig;
  workspace_path: string; // 任务工作目录的绝对路径
  request_path: string; // 原始 Markdown 输入文件路径
  status: TaskStatus;
  current_iteration: number; // 已完成轮次
  best_score: number; // 历史最佳分数
  best_iteration: number; // 取得最佳分数的轮次
  direction_payload: Record<string, unknown>; // 方向特异字段
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 方向契约
// ============================================================================

/**
 * 每个方向通过实现 DirectionAdapter 接入 core 的自循环引擎。
 *
 * core/self_loop.ts 在每个阶段调用 adapter 的对应方法。
 * adapter 自身可以再调用方向内部的更细分模块(executor / evaluator / diagnoser)。
 */
export interface DirectionAdapter {
  direction: LoopDirection;

  /** 需要升级人工的归因分类集合，core 据此决定是否暂停循环 */
  escalate_categories: ReadonlySet<string>;

  /** Plan 阶段:解析需求 + 校验 + 准备 workspace */
  plan(task: LoopTask): Promise<LoopTask>;

  /** Execute 阶段:执行一轮编码/采集/评测 */
  execute(
    task: LoopTask,
    iteration: number,
    context: ExecuteContext,
  ): Promise<{
    changed_files: string[];
    commit_sha?: string;
  }>;

  /** Evaluate 阶段:对照 hard gates + 软分 */
  evaluate(task: LoopTask, iteration: number): Promise<EvaluationResult>;

  /** Repair 阶段:失败归因 + 准备下一轮 patch 输入 */
  diagnose(
    task: LoopTask,
    iteration: number,
    evaluation: EvaluationResult
  ): Promise<Diagnosis>;

  /** Report 阶段:每轮汇报(返回简短 summary 字符串) */
  report(task: LoopTask, iter: IterationResult): Promise<string>;
}

/**
 * Execute 阶段的跨轮上下文。
 *
 * self_loop 在调用 adapter.execute 时把上一轮的评估、归因、以及完整历史
 * 一并塞入,便于 adapter 内部组装 prompt 或决策。
 *
 * - 第 1 轮:prev_evaluation/prev_diagnosis 都为 undefined,history=[]
 * - 第 N>1 轮:prev_* 是 N-1 轮的结果,history 是 1..N-1 的全部记录
 */
export interface ExecuteContext {
  prev_evaluation?: EvaluationResult;
  prev_diagnosis?: Diagnosis;
  history: IterationResult[];
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  max_iterations: 10,
  min_score: 0.92,
  autonomy_mode: "standard",
};
