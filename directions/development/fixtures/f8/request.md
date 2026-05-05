# 开发调试任务

## 目标

修复 fizzbuzz 函数的 bug：fizzbuzz(15) 应该返回 "FizzBuzz" 但当前返回 "Fizz"。

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 使用 JavaScript (CommonJS)
- 不引入新的运行时依赖
- 最小化修复，不要重写整个函数

## 禁止改动

- package.json
- test/

## Bug 复现

fizzbuzz(15) 返回 "Fizz" 但预期是 "FizzBuzz"

## 配置

```yaml
task_type: bugfix
language: javascript
success_criteria:
  hard_gates:
    - test
loop_config:
  max_iterations: 3
  min_score: 1.0
  autonomy_mode: standard
  execution_style: ai_autonomous
```
