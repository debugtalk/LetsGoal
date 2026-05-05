# 开发调试任务

## 目标

修复 `src/config-parser.ts` 中的问题，使 typecheck 和测试全部通过。

## 项目根目录

/tmp/letsgoal-m1-bugfix

## 约束

- 使用 TypeScript strict 模式
- 不引入新的运行时依赖
- 只修改 `src/config-parser.ts`，不要改动其他文件
- 保持现有 API 签名不变

## 禁止改动

- package.json
- tsconfig.json
- test/
- eval-cases/

## Bug 复现

运行 `tsc --noEmit` 报类型错误。修复类型问题后，`vitest run` 仍有测试失败。

## 配置

```yaml
task_type: bugfix
language: typescript
success_criteria:
  hard_gates:
    - typecheck
    - test
loop_config:
  max_iterations: 4
  min_score: 1.0
  autonomy_mode: standard
eval_suite:
  version: v1
  files:
    - "test/*.test.ts"
    - "eval-cases/*.json"
```
