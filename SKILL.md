---
name: letsgoal
description: |-
  目标导向的 Agent 自循环框架。用户给出目标和成功标准，系统自主完成
  Plan → Execute → Evaluate → Repair → Report 五阶段闭环，仅在关键决策点引入人工。
  M0 已实现「开发调试」方向（编码→验证→修复→汇报），适用于有明确测试/验收标准的开发任务。
  TRIGGER when: 用户提交结构化开发任务需求（Markdown），或要求系统
  "自动修 bug 直到测试通过"、"按验收标准迭代实现功能"、"创建/优化 Skill"等场景。
  SKIP when: 一次性单步操作、无验收标准的开放探索、需要全程人工决策的高风险变更。
---

# LetsGoal Skill

## 适用场景

- 有明确目标 + 可判定的成功标准（测试通过 / lint 无错 / 类型检查通过）
- 需要多轮迭代逐步收敛，而非一次性产出
- 失败可以归因 + 自愈，无法自愈才升级人工

## 输入契约

输入是 Markdown 文件，完整模板见 `directions/development/templates/request.md`。

关键字段：

```yaml
goal: <一句话目标，例：实现 fizzbuzz 函数通过所有测试>
project_root: <被开发项目的绝对路径>
success_criteria:
  hard_gates: [lint, typecheck, test]  # 必过项（M0 支持 lint/typecheck/test）
constraints:
  - 使用 TypeScript
  - 不引入新的运行时依赖
forbidden_changes:
  - package.json
  - test/
```

开发调试方向特异字段（在 `## 配置` 的 YAML 代码块中）：

```yaml
task_type: feature | bugfix | refactor | skill_creation | skill_optimize
language: typescript | javascript | python | rust | go
commands:           # 可选，省略时自动探测
  lint: npm run lint
  typecheck: npm run typecheck
  test: npm test
loop_config:
  max_iterations: 3   # 默认 10
  min_score: 1.0      # 默认 0.92
  autonomy_mode: standard  # strict | standard | autonomous（M2 启用，M0/M1 默认 standard）
eval_suite:          # M1+ 可选，评测集冻结配置
  version: v1
  files:
    - "test/**"
    - "eval-cases/**"
```

## 输出契约

### 单轮迭代输出

```yaml
iteration: 3
status: passed | failed
evaluation:
  hard_gates:
    - { gate: lint, passed: true }
    - { gate: typecheck, passed: true }
    - { gate: test, passed: false, detail: "exit_code=1: FAIL fizzbuzz(15)" }
  hard_gates_all_passed: false
  weighted_score: 0
diagnosis:
  category: test_failure        # M1 归因分类（9 类）
  reason: "test: FAIL fizzbuzz(15) returns 'Fizz' but expected 'FizzBuzz'"
  evidence:
    - "FAIL test/fizzbuzz.test.js > fizzbuzz(15) returns 'FizzBuzz'"
changed_files:
  - src/fizzbuzz.ts
commit_sha: a1b2c3d
next_action: retry
```

### 终态产物

- `task-state.json`：任务完整状态（位于 `<workspace>/.letsgoal/`）
- `iterations.jsonl`：全部迭代记录
- `iterations/iter-N.log`：每轮 executor 子进程完整日志
- `final-report.md`：终态汇报（成功/失败、最佳轮次、产物列表）
- Git commits：每轮一次 commit，message 格式 `letsgoal(iter-N): <description>`

## 调用方式

```bash
npm run self-loop -- --direction development --input request.md --workspace ./workspace
```

参数：
- `--direction`：方向（M0 仅支持 `development`）
- `--input`：Markdown 任务文件路径
- `--workspace`：工作目录（`.letsgoal/` 状态文件写入此处）
- `--dry-run`：解析 + plan 后退出，不进入主循环

代码调用：

```typescript
import { parseMarkdownTask } from "./core/scripts/parse_request.js";
import { runSelfLoop } from "./core/scripts/self_loop.js";

const task = await parseMarkdownTask({ inputPath: "request.md", workspacePath: "./workspace" });
await runSelfLoop(task);
```

## 终止条件

**成功**：hard gates 全部通过且 `weighted_score >= min_score`

**失败**：

- 达到 `max_iterations`（默认 10）
- Plan/Execute/Evaluate 阶段抛出异常

终止时返回：`final-report.md` + 终端摘要。

## 红线

执行循环过程中即使 auto-accept 也必须停下来问的动作：

- 删除文件、目录或 git 历史
- 修改 .env、密钥、CI/CD 配置
- 数据库 schema 变更
- git push、强制推送、`git reset --hard`
- 公开发布（npm publish、部署到生产）
- 修改 `core/` 共享代码（影响所有方向）
