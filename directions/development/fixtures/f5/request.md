# 开发调试任务

## 目标

优化现有的「代码审查助手」Skill，使其通过所有评测用例。

当前 SKILL.md 是一个半成品，缺少「输出审查建议」步骤。需要补全缺失的内容，使所有 eval case 通过。

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 只修改 SKILL.md，不要改动其他文件
- 保持现有内容不变，只补充缺失的步骤
- 不引入新的运行时依赖

## 禁止改动

- package.json
- test/
- eval-cases/

## 配置

```yaml
task_type: skill_optimize
language: javascript
success_criteria:
  hard_gates:
    - skill_syntax
    - skill_eval
loop_config:
  max_iterations: 3
  min_score: 1.0
  autonomy_mode: standard
```
