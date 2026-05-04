# 开发调试任务

## 目标

补全 `fizzbuzz.js` 的实现，使所有测试通过。

当前实现只处理了能被 3 整除的情况，缺少：
- 能被 5 整除时返回 `"Buzz"`
- 能同时被 3 和 5 整除时返回 `"FizzBuzz"`

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 使用 JavaScript (CommonJS)
- 不引入新的运行时依赖
- 只修改 `fizzbuzz.js`，不要改动其他文件

## 禁止改动

- package.json
- test/

## 配置

```yaml
task_type: feature
language: javascript
success_criteria:
  hard_gates:
    - test
loop_config:
  max_iterations: 3
  min_score: 1.0
  autonomy_mode: standard
```
