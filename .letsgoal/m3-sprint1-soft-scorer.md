# 开发调试任务

## 目标

在 directions/development/scripts/ 下新建 soft_scorer.ts 模块，实现加权软分计算功能，使 directions/development/scripts/__tests__/soft_scorer.test.ts 中的 17 个测试全部通过。

模块需导出以下 API：
- `extractCoverageFromOutput(stdout: string): number | undefined` — 从 vitest/jest 覆盖率输出中提取行覆盖率百分比（0-1）
- `computeSoftScores(raw: EvaluatorResult, coverageTarget: number): SoftScoreItem[]` — 计算 4 维软分（coverage/complexity/smells/docs），后三项 M3 初期 stub 为 1.0
- `computeWeightedScore(items: SoftScoreItem[]): number` — 计算 sum(score * weight) 作为加权总分
- `DEFAULT_SOFT_SCORE_WEIGHTS` — 默认权重常量 { coverage: 0.4, complexity: 0.2, smells: 0.2, docs: 0.2 }

覆盖率提取逻辑：在 stdout 中查找 "All files" 行，提取 "% Lines" 列的数值（百分比），除以 100 转为 0-1 范围。找不到则返回 undefined。

覆盖率软分计算：`extracted / coverageTarget`，上限为 1.0。找不到覆盖率数据时默认 1.0。

## 项目根目录

/Users/debugtalk/MyProjects/MyGitHub/notes/projects/LetsGoal

## 约束

- 使用 TypeScript
- 不引入新的运行时依赖
- 遵循项目现有代码风格（snake_case 字段名，JSDoc 注释）
- soft_scorer.ts 放在 directions/development/scripts/ 目录下
- 从 ../types.js 导入 EvaluatorResult 和相关类型
- 从 ../../../core/scripts/types.js 导入 SoftScoreItem 类型

## 禁止改动

- core/scripts/types.ts
- core/scripts/self_loop.ts
- core/scripts/parse_request.ts
- core/references/loop-protocol.md
- directions/development/scripts/adapter.ts
- directions/development/scripts/evaluator.ts
- directions/development/scripts/executor.ts
- directions/development/scripts/classifier.ts
- directions/development/scripts/diagnose.ts
- directions/development/scripts/__tests__/classifier.test.ts
- directions/development/scripts/__tests__/diagnose.test.ts
- directions/development/scripts/__tests__/eval_suite.test.ts
- directions/development/scripts/__tests__/evaluator.test.ts
- directions/development/scripts/__tests__/skill_eval.test.ts
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
