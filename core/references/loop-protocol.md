# LetsGoal 自循环协议（Loop Protocol）

> 本文档定义 core 自循环引擎与方向适配器（DirectionAdapter）之间的对接契约。三个方向共享同一协议，差异通过方向配置承载。

## 1. 协议概述

自循环由 **Plan → Execute → Evaluate → Repair → Report** 五阶段组成，每阶段的数据结构、调用顺序和终止条件如下文所述。

## 2. 五阶段数据流

```
LoopTask (初始任务定义)
  │
  ▼
Plan     → LoopTask（校验 + 准备 workspace）
  │
  ▼
Execute  → { changed_files, commit_sha? } + 副作用（代码/采集/评测）
  │
  ▼
Evaluate → EvaluationResult（hard_gates + weighted_score）
  │
  ├─ 通过 ───────────────────────────────┐
  │                                     ▼
  └─ 失败 ──► Repair ─────────────► Report
  │                                     │
  └─ 无法修复（ escalate ）───────────────┘
```

### 2.1 Plan（规划）

**触发**：自循环启动时调用一次。

**职责**：
- 校验方向特异字段（如 `project_root` 是否存在、是否为 git 仓库）
- 准备 workspace 目录结构（`<workspace>/.letsgoal/`）
- 填充默认值（未提供的字段回退到方向默认值）

**输入**：`LoopTask`（由 `parse_request.ts` 解析生成）

**输出**：`LoopTask`（经过校验和默认值填充后的版本）

**失败处理**：抛出异常，自循环直接终止，终态为 `failed`。

### 2.2 Execute（执行）

**触发**：每轮迭代调用一次。

**职责**：
- 调用方向内部的 executor 完成一轮编码/采集/评测
- 将变更写入文件系统或外部系统
- 通过 Git commit 或其他方式固化本轮产物

**输入**：
- `LoopTask`：当前任务定义
- `iteration: number`：当前轮次（从 1 开始）
- `ExecuteContext`：跨轮上下文
  - `prev_evaluation`：上一轮评估结果（第 1 轮为 `undefined`）
  - `prev_diagnosis`：上一轮失败归因（第 1 轮为 `undefined`）
  - `history`：1..N-1 轮的完整 `IterationResult` 数组

**输出**：
```typescript
{
  changed_files: string[];  // 本轮修改的文件列表
  commit_sha?: string;      // 如果使用 Git 状态源，写入本轮 commit hash
}
```

**副作用**：executor 可以产生任意副作用（写文件、spawn 子进程、调用 API 等）。core 不限制副作用范围，方向内部自行约束。

### 2.3 Evaluate（评估）

**触发**：Execute 成功后调用。

**职责**：
- 对照 `LoopTask.success_criteria` 执行评估
- 计算 hard gates 通过状态
- 计算加权软分（M1 引入，M0 简化为"全过 1.0 / 否则 0.0"）

**输入**：
- `LoopTask`：当前任务定义
- `iteration: number`：当前轮次

**输出**：`EvaluationResult`

```typescript
interface EvaluationResult {
  hard_gates: HardGateResult[];      // 每个必过项的通过状态
  hard_gates_all_passed: boolean;    // 所有 hard_gates 都通过
  soft_scores?: SoftScoreItem[];     // M1 引入的加权软分明细
  weighted_score: number;            // [0, 1]，M0 简化为硬门禁函数
}
```

**重要约束**：evaluator **不得修改任何文件**，只读取项目状态。

### 2.4 Repair（归因 + 修复准备）

**触发**：Evaluate 返回 `hard_gates_all_passed === false` 时调用。

**职责**：
- 分析 `EvaluationResult`，定位失败原因
- 生成 `Diagnosis`，包含 reason（自由文本）和可选 evidence
- M1 引入 `category` 方向特异分类

**输入**：
- `LoopTask`：当前任务定义
- `iteration: number`：当前轮次
- `EvaluationResult`：本轮评估结果

**输出**：`Diagnosis`

```typescript
interface Diagnosis {
  category?: string;      // 方向特异分类（M1 启用）
  reason: string;         // 失败原因自由文本摘要
  evidence?: string[];    // 辅助证据（stderr 摘要、失败测试名等）
}
```

**注意**：Repair 阶段本身不修改代码。修复动作由下一轮 Execute 阶段根据 `Diagnosis` 和 `ExecuteContext` 中的信息驱动。方向适配器中对应的方法名为 `diagnose()`。

### 2.5 Report（汇报）

**触发**：每轮迭代结束时调用（无论通过或失败）。

**职责**：
- 生成本轮简短摘要字符串
- core 将摘要输出到终端，并写入 `iterations.jsonl`

**输入**：
- `LoopTask`：当前任务定义
- `IterationResult`：本轮完整结果

**输出**：`string`（单行摘要，用于终端输出）

## 3. 状态持久化

core 在 `<workspace>/.letsgoal/` 下维护以下文件：

| 文件 | 格式 | 更新时机 | 用途 |
|------|------|---------|------|
| `task-state.json` | JSON | 每轮更新 | 当前 LoopTask 完整状态，支持 resume |
| `iterations.jsonl` | JSON Lines | 每轮追加 | 全部 `IterationResult` 历史 |
| `iterations/iter-N.log` | 文本 | 每轮写入 | 第 N 轮 executor 子进程的完整日志 |
| `final-report.md` | Markdown | 终态时写入 | 终态汇报（成功/失败、最佳轮次、产物列表） |

## 4. DirectionAdapter 契约

每个方向通过实现 `DirectionAdapter` 接口接入 core：

```typescript
interface DirectionAdapter {
  direction: LoopDirection;
  plan(task: LoopTask): Promise<LoopTask>;
  execute(
    task: LoopTask,
    iteration: number,
    context: ExecuteContext,
  ): Promise<{ changed_files: string[]; commit_sha?: string }>;
  evaluate(task: LoopTask, iteration: number): Promise<EvaluationResult>;
  diagnose(
    task: LoopTask,
    iteration: number,
    evaluation: EvaluationResult,
  ): Promise<Diagnosis>;
  report(task: LoopTask, iter: IterationResult): Promise<string>;
}
```

**加载方式**：core 通过 `--direction <name>` 动态 import `directions/<name>/scripts/adapter.ts`。

**依赖方向**：
- 方向脚本 **可以** 调用 core 中的工具（`parse_request`、`types` 等）
- core **不允许** 感知方向内部实现（`DirectionAdapter` 是唯一的对接面）

## 5. 终止条件

自循环在以下任一条件触发时终止：

| 条件 | 终态 | 说明 |
|------|------|------|
| `hard_gates_all_passed && weighted_score >= min_score` | `passed` | 全部硬门禁通过且分数达标 |
| `current_iteration >= max_iterations` | `failed` | 达到最大迭代轮次 |
| Plan 阶段抛出异常 | `failed` | 前置校验不通过 |
| Execute / Evaluate 阶段抛出异常 | `failed` | 执行或评估过程出错（core 捕获异常后终止） |

## 6. 跨轮记忆

core 通过两种机制实现跨轮记忆：

1. **`ExecuteContext`**：将上一轮评估和归因直接传入下一轮 Execute，供 adapter 组装 prompt 或决策。
2. **状态文件**：`task-state.json` 保存当前轮次、最佳分数等元数据；`iterations.jsonl` 保存完整历史。
3. **Git commit**：开发调试方向以 commit history 为主要跨轮记忆，executor prompt 中注入 `git log` 摘要。

方向可自行选择主要记忆源（开发调试选 Git，数据采集/模型调优可选状态文件）。

## 7. M0 与 M1+ 的差异

| 特性 | M0 | M1 | M2+ |
|------|----|----|-----|
| 硬门禁 | lint/typecheck/test | 同上 | + coverage、e2e |
| 加权软分 | 简化（全过 1.0） | 引入覆盖率/复杂度等 | 完整权重体系 |
| 归因分类 | 自由文本（无 category） | 引入方向特异分类 | 分类 + 自动修复策略 |
| 渐进式自主 | standard 固定 | standard 固定 | strict/standard/autonomous |
| 飞书通知 | ❌ | ⚠️ 可选 | ✅ |
| 多任务并行 | ❌ | ❌ | ✅ |
