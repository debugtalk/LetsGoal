# 开发调试任务

## 目标

实现 fizzbuzz 函数，通过所有测试用例。按 Story 粒度逐步完成：

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 使用 JavaScript (CommonJS)
- 不引入新的运行时依赖
- 在仓库根目录创建 `fizzbuzz.js` 文件，导出一个函数

## 禁止改动

- package.json
- test/

## Stories

- id: div3
  title: 实现被 3 整除返回 Fizz
- id: div5
  title: 实现被 5 整除返回 Buzz
- id: div15
  title: 实现同时被 3 和 5 整除返回 FizzBuzz

## 配置

```yaml
task_type: feature
language: javascript
success_criteria:
  hard_gates:
    - test
loop_config:
  max_iterations: 5
  min_score: 1.0
  autonomy_mode: standard
```
