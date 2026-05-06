# 开发调试任务

## 目标

在 core/scripts/ 下新建 autonomy.ts 模块，实现渐进式自主模式逻辑，使 core/scripts/__tests__/autonomy.test.ts 中的测试全部通过。

模块需导出以下 API：

- `shouldPauseBeforeExecution(mode: AutonomyMode): boolean` — strict 返回 true，其他 false
- `shouldPauseOnEscalation(mode: AutonomyMode): boolean` — strict 返回 true，其他 false
- `claudePermissionMode(mode: AutonomyMode): string` — strict → "default"，standard → "bypassPermissions"，autonomous → "bypassPermissions"
- `reportVerbosity(mode: AutonomyMode): "full" | "minimal" | "silent"` — strict → "full"，standard → "full"，autonomous → "minimal"
- `loadResumedState(workspacePath: string): ResumedState | null` — 从 workspace/.letsgoal/ 读取 task-state.json 和 iterations.jsonl，恢复任务状态。仅当 status 为 "awaiting_human" 或 "paused" 时恢复，恢复时将 status 改为 "running"。从 iterations.jsonl 的最后一轮提取 prevEvaluation 和 prevDiagnosis。

`ResumedState` 接口：
```typescript
interface ResumedState {
  task: LoopTask;
  iterations: IterationResult[];
  prevEvaluation: EvaluationResult | undefined;
  prevDiagnosis: Diagnosis | undefined;
}
```

AutonomyMode 类型从 ./types.js 导入，LoopTask、IterationResult、EvaluationResult、Diagnosis 同理。

## 项目根目录

/Users/debugtalk/MyProjects/MyGitHub/notes/projects/LetsGoal

## 约束

- 使用 TypeScript
- 不引入新的运行时依赖
- 遵循项目现有代码风格

## 禁止改动

- core/scripts/types.ts
- core/scripts/self_loop.ts
- core/scripts/parse_request.ts
- core/references/loop-protocol.md
- directions/development/scripts/
- package.json
- tsconfig.json
- vitest.config.ts

## Bug 复现

## 配置

```yaml
task_type: feature
language: typescript
success_criteria:
  hard_gates:
    - typecheck
    - test
loop_config:
  max_iterations: 4
  min_score: 1.0
  autonomy_mode: standard
commands:
  lint: exit 0
  typecheck: npx tsc --noEmit
  test: npx vitest run
```
