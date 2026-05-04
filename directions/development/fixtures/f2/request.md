# 开发调试任务

## 目标

修复 `fizzbuzz.js` 中的 bug，使所有测试通过。

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 使用 JavaScript (CommonJS)
- 不引入新的运行时依赖
- 只修改 `fizzbuzz.js`，不要改动其他文件

## 禁止改动

- package.json
- test/

## Bug 复现

运行 `npm test` 时，`fizzbuzz(15)` 返回 `"Fizz"`，但期望返回 `"FizzBuzz"`。
同样 `fizzbuzz(30)` 也会失败。

根因：`fizzbuzz.js` 中先判断了 `n % 3 === 0`，导致能被 15 整除的数字提前返回了 `"Fizz"`，永远不会走到同时判断 3 和 5 的逻辑。

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
```
