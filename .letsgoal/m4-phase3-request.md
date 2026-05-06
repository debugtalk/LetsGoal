# 开发调试任务

## 目标

实现 M4 阶段 3：质量（软分维度补全 + L0-L3 分层评估 + 归因分类器增强）。

具体包括三个子任务：

### 3.1 软分维度补全

修改 `directions/development/scripts/soft_scorer.ts`，将目前 3/4 维度硬编码 1.0 替换为真实计算：

- **smells**：解析 lint 输出中 `N problems (E errors, W warnings)` → `score = max(0, 1 - warnings/20)`
- **complexity**：优先解析 eslint complexity 规则输出；回退到 changed files 数量启发式 `score = max(0, 1 - changedFiles/10)`
- **docs**：changed files 包含 README/CHANGELOG/.md → 1.0，否则 → 0.7

需要修改 `directions/development/scripts/adapter.ts`，传递 `changedFiles` 给 `computeSoftScores`。

当前 `computeSoftScores` 签名：
```typescript
export function computeSoftScores(
  raw: EvaluatorResult,
  coverageTarget: number,
  coverageExtracted?: number,
): SoftScoreItem[]
```

新签名：
```typescript
export function computeSoftScores(
  raw: EvaluatorResult,
  coverageTarget: number,
  coverageExtracted?: number,
  changedFiles?: string[],
): SoftScoreItem[]
```

### 3.2 L0-L3 分层评估

重构 `directions/development/scripts/evaluator.ts` 的 `evaluateTask`，改为分层执行：

- L0（结构）：lint + typecheck → 失败则跳过 L1+
- L1（功能）：test → 失败则跳过 L2+
- L2（质量）：coverage + soft scores（由 adapter 计算，evaluator 不跑额外命令）
- L3（专项）：skill_syntax + skill_eval（仅 skill 任务）

当前 evaluator 一次性全跑三门禁。改为：L0 失败 → 直接返回（跳过 L1-L3）；L1 失败 → 返回 L0+L1 结果（跳过 L2-L3）。

需要在 `core/scripts/types.ts` 的 `EvaluationResult` 新增 `failed_tier?: string` 字段。

修改 `directions/development/scripts/executor.ts` 的 `buildPrompt`，根据失败层级给 Claude 不同聚焦指引：
- L0 失败："上一轮在 L0 失败（语法/类型错误），仅修复这些基础问题，不要尝试功能变更"
- L1 失败："L0 已通过，专注让测试通过"
- L2 失败："功能已通过，专注提高覆盖率和代码质量"

### 3.3 归因分类器增强

修改 `directions/development/scripts/classifier.ts`：

1. 新增 6 条规则：
   - 同 category 连续 3 次 → `architecture_mismatch`（跨迭代模式）
   - 空 commit_sha + 无 changed_files → `requirement_ambiguity`（Claude 放弃）
   - typecheck 输出含 "circular"/"Circular dependency" → `architecture_mismatch`
   - typecheck 输出含 3+ 个 "is not assignable" → `architecture_mismatch`
   - test 输出含 "contradict"/"Conflict" → `requirement_ambiguity`
   - 兜底：同 category 重复 3 次 → 升级为 `architecture_mismatch`

2. `classifyFailure` 增加 `iterationHistory` 可选参数：
```typescript
export function classifyFailure(
  evaluation: EvaluationResult,
  raw?: EvaluatorResult,
  taskType?: DevTaskType,
  iterationHistory?: IterationResult[],
): DiagnosisCategory
```

3. 修改 `directions/development/scripts/diagnose.ts`，传递迭代历史给 `classifyFailure`
4. 修改 `directions/development/scripts/adapter.ts`，在 diagnose 中传递迭代历史
5. 修改 `core/scripts/types.ts` 的 `DirectionAdapter.diagnose` 签名，增加 `history?` 参数：
```typescript
diagnose(
  task: LoopTask,
  iteration: number,
  evaluation: EvaluationResult,
  history?: IterationResult[],
): Promise<Diagnosis>;
```

### 重要约束

- `iterationHistory` 为可选参数，不传时行为不变（向后兼容）
- `changedFiles` 为可选参数，不传时 smells/complexity/docs 使用默认值
- `failed_tier` 为可选字段，不影响现有代码
- 所有新增代码必须有 vitest 测试
- 现有 188 个测试全部通过后才能提交
- classifier.ts 新规则不应影响已有分类规则的优先级

## 项目根目录

/Users/debugtalk/MyProjects/MyGitHub/notes/projects/LetsGoal

## 约束

- 使用 TypeScript
- 不引入新的运行时依赖
- 保持现有 API 兼容（所有已有测试必须继续通过）
- 新增参数均为可选（不破坏现有调用方）
- L0-L3 分层只影响评估顺序，不改变 EvaluatorResult 结构
- 阈值常量：MAX_LINT_WARNINGS=20, COMPLEXITY_BASELINE=10, DOCS_NO_DOC_SCORE=0.7
- classifier 新规则不应与现有规则冲突

## 禁止改动

- core/references/loop-protocol.md
- directions/development/DIRECTION.md
- docs/roadmap.md
- docs/design.md

## 配置

```yaml
task_type: feature
language: typescript
success_criteria:
  hard_gates:
    - typecheck
    - test
loop_config:
  max_iterations: 5
  min_score: 1.0
  autonomy_mode: standard
commands:
  typecheck: npx tsc --noEmit
  test: npx vitest run
```
