# 开发调试任务

## 目标

实现一个 fizzbuzz 函数，通过所有测试用例。函数接收一个正整数 n，返回：
- 如果 n 能被 3 整除，返回 "Fizz"
- 如果 n 能被 5 整除，返回 "Buzz"
- 如果 n 同时能被 3 和 5 整除，返回 "FizzBuzz"
- 否则返回 n 的数字字符串形式

## 项目根目录

{{PROJECT_ROOT}}

## 约束

- 使用 JavaScript (CommonJS)
- 不引入新的运行时依赖
- 在仓库根目录创建 `fizzbuzz.js` 文件，导出一个函数

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
