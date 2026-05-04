# 开发调试方向白盒验收用例

三个 fixture 覆盖开发调试方向的三类典型任务，均使用同一套 fizzbuzz 测试用例，差异仅在初始代码状态。

## 用例概览

| Fixture | 场景 | 初始 `fizzbuzz.js` | 预期修复 |
|---------|------|-------------------|----------|
| **F1** | 从零实现 | 文件不存在 | 创建完整实现 |
| **F2** | Bug 修复 | 漏了 `%15` 判断（15→"Fizz"） | 增加 `%15` 分支 |
| **F3** | 补全实现 | 只实现了 `%3` | 增加 `%5` 和 `%15` 分支 |

验收标准：**≤3 轮内通过**（实际均在 1 轮内通过）。

## 测试用例

```javascript
fizzbuzz(1)  → "1"
fizzbuzz(3)  → "Fizz"
fizzbuzz(5)  → "Buzz"
fizzbuzz(15) → "FizzBuzz"
fizzbuzz(30) → "FizzBuzz"
```

## 环境说明

每个 fixture 包含：

- `package.json` — 定义 `npm test` 命令
- `.letsgoal-dev.json` — 将 lint/typecheck 命令重定向到 `exit 0`，确保验收聚焦在测试逻辑上
- `test/fizzbuzz.test.js` — 5 条测试用例
- `request.md` — 自循环输入任务描述

`.letsgoal-dev.json` 的作用：

```json
{
  "commands": {
    "lint": "exit 0",
    "typecheck": "exit 0"
  }
}
```

这告诉 evaluator 不要尝试自动探测 eslint/tsc，而是直接跳过 lint/typecheck 门禁。F1/F2/F3 的核心关注点是逻辑正确性，不是 lint/typecheck 环境配置。

## 手动验收

```bash
# 1. 复制 fixture 到临时目录
FIXTURE=f1  # 或 f2、f3
TEST_DIR="/tmp/lg-$FIXTURE-test"
WORKSPACE="/tmp/lg-$FIXTURE-workspace"
FIXTURE_DIR="$(cd "$(dirname "$0")/$FIXTURE" && pwd)"

rm -rf "$TEST_DIR" "$WORKSPACE"
mkdir -p "$TEST_DIR"
cp "$FIXTURE_DIR"/* "$TEST_DIR/"
cp "$FIXTURE_DIR/.letsgoal-dev.json" "$TEST_DIR/"

# 2. 替换 PROJECT_ROOT 占位符
sed -i "s|{{PROJECT_ROOT}}|$TEST_DIR|g" "$TEST_DIR/request.md"

# 3. 初始化 git
cd "$TEST_DIR"
git init
git config user.email "test@letsgoal.dev"
git config user.name "LetsGoal Test"
git add .
git commit -m "Initial state: $FIXTURE fixture"

# 4. 运行自循环（从项目根目录）
cd "$(dirname "$0")/../../.."  # 回到 LetsGoal 根目录
npm run self-loop -- \
  --direction development \
  --input "$TEST_DIR/request.md" \
  --workspace "$WORKSPACE"
```
