# 开发调试方向白盒验收用例

五个 fixture 覆盖开发调试方向的五类典型任务。F1–F3 使用 fizzbuzz 测试用例，F4–F5 使用 Skill 评测用例。

## 用例概览

| Fixture | 场景 | task_type | 初始状态 | 预期修复 |
|---------|------|-----------|---------|----------|
| **F1** | 从零实现 | feature | `fizzbuzz.js` 不存在 | 创建完整实现 |
| **F2** | Bug 修复 | bugfix | 漏了 `%15` 判断（15→"Fizz"） | 增加 `%15` 分支 |
| **F3** | 补全实现 | feature | 只实现了 `%3` | 增加 `%5` 和 `%15` 分支 |
| **F4** | Skill 创建 | skill_creation | `SKILL.md` 不存在 | 从零创建完整的 SKILL.md |
| **F5** | Skill 优化 | skill_optimize | `SKILL.md` 缺少「输出审查建议」步骤 | 补全缺失步骤 |

验收标准：**≤3 轮内通过**（F1–F3 实际均在 1 轮内通过）。

## 测试用例

### F1–F3：FizzBuzz 逻辑测试

```javascript
fizzbuzz(1)  → "1"
fizzbuzz(3)  → "Fizz"
fizzbuzz(5)  → "Buzz"
fizzbuzz(15) → "FizzBuzz"
fizzbuzz(30) → "FizzBuzz"
```

### F4–F5：Skill 评测用例

F4 和 F5 使用 `eval-cases/` 目录下的 JSON 文件作为评测标准，每个 case 检查 SKILL.md 是否包含特定章节：

| Eval Case | 检查内容 | F4（初始） | F5（初始） |
|-----------|---------|-----------|-----------|
| case-1 | `name: code-reviewer` | ❌ | ✅ |
| case-2 | `## 适用场景` | ❌ | ✅ |
| case-3 | 输出审查建议 / 输入输出契约+执行步骤 | ❌ | ❌ |

F4 初始状态：SKILL.md 不存在，所有 case 均失败。
F5 初始状态：SKILL.md 是半成品，case-3 缺少「输出审查建议」步骤。

## 环境说明

每个 fixture 包含：

- `package.json` — 定义 `npm test` 命令
- `.letsgoal-dev.json` — 将 lint/typecheck 命令重定向到 `exit 0`，确保验收聚焦在测试逻辑上
- `request.md` — 自循环输入任务描述

F1–F3 额外包含：
- `test/fizzbuzz.test.js` — 5 条 FizzBuzz 测试用例

F4–F5 额外包含：
- `eval-cases/` — 3 个 JSON 评测用例
- `test/fixture.test.js` — 读取 eval case 并检查 SKILL.md
- `check-eval.js` — 辅助脚本，独立检查 eval case 通过情况

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
