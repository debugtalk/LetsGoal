# 开发调试方向定义

## 方向定位

用户描述需求和成功标准，系统自主完成编码、验证、修复、重构和阶段性汇报，仅在方案 review、路线选择等关键决策点引入人工。覆盖三类典型任务：

- 实现新功能（从零）
- 修复 bug（目标系统已存在）
- 创建/优化 Skill（M1 重点场景）

本方向以 **Git 为主状态源**，commit history 即跨轮记忆；状态文件作为补充。

## 输入字段

输入为 Markdown 文件，完整模板见 `templates/request.md`。共享层字段（`goal` /
`success_criteria` / `constraints` / `forbidden_changes`）由 core 解析，本方向特异字段
（`DevTaskRequest`）如下：

| 字段 | 必填 | 说明 |
|------|------|------|
| `project_root` | 是 | 被开发项目的根目录（可与 workspace 不同） |
| `language` | 否 | 项目主语言（typescript / python / rust / go / 其他）。若未给，从 package.json/pyproject.toml 自动探测 |
| `commands.lint` | 否 | lint 命令。未给时 fallback 到 `npm run lint` / `ruff check` 等 |
| `commands.typecheck` | 否 | 类型检查命令。fallback 到 `npm run typecheck` / `mypy` 等 |
| `commands.test` | 否 | 测试命令。fallback 到 `npm test` / `pytest` 等 |
| `coverage_target` | 否 | 测试覆盖率最低值（0..1），M2 启用 |
| `task_type` | 否 | `feature` / `bugfix` / `refactor` / `skill_creation` / `skill_optimize`。M0 默认 `feature` |
| `bug_repro` | bug 修复必填 | 复现步骤 / 报错日志 / 触发条件 |

## 命令发现策略

为兼容多语言项目，evaluator 按以下顺序定位三件套命令：

1. `DevTaskRequest.commands.<name>` 显式声明（优先级最高）
2. 项目根 `package.json` 的 `scripts.<name>`（Node.js 项目）
3. 项目根 `.letsgoal-dev.json` 的 `commands.<name>`
4. 语言默认值：
   - TypeScript/JavaScript:`eslint .` / `tsc --noEmit` / `vitest run`
   - Python:`ruff check` / `mypy .` / `pytest`
   - Rust:`cargo clippy` / `cargo check` / `cargo test`
   - Go:`golangci-lint run` / `go vet ./...` / `go test ./...`
5. 都未找到 → 该门禁 **skip**（不算失败也不算通过）

## 硬门禁

| 门禁 | M0 | M1 | M2+ |
|------|----|----|-----|
| `lint` 通过 | ✅ | ✅ | ✅ |
| `typecheck` 通过 | ✅ | ✅ | ✅ |
| `test` 全通过 | ✅ | ✅ | ✅ |
| `coverage` 达标 | ❌ | ⚠️ 可选 | ✅ |
| `e2e` 通过（L3） | ❌ | ⚠️ 可选 | ✅ |
| `禁止改动文件` 未被改 | ❌ | ✅ | ✅ |

M0 实施细节：任一硬门禁失败 → `weighted_score = 0`，本轮 fail；全部通过 →
`weighted_score = 1.0`，本轮 pass。M1 引入加权软分后 weighted_score 反映质量趋势。

## 加权软分（M1+）

| 项 | 默认权重 | 说明 |
|----|---------|------|
| 测试覆盖率 | 0.4 | 实际覆盖 / 目标覆盖，封顶 1.0 |
| 代码复杂度（可选） | 0.2 | 函数复杂度上限达标率 |
| 代码异味数 | 0.2 | (1 - smells/files) |
| 文档完整性 | 0.2 | 公共 API 注释覆盖率 |

权重可在 DevTaskRequest 中覆盖。

## 失败归因分类

M0 仅自由文本（`Diagnosis.reason`），M1 引入分类（`Diagnosis.category`），共 9 类：

| 分类 | 含义 | 自动修复策略 |
|------|------|------------|
| `syntax_error` | 语法错误 | ✅ 直接修复 |
| `type_error` | 类型错误 | ✅ 直接修复 |
| `lint_violation` | lint 报错 | ✅ 直接修复 |
| `test_failure` | 测试失败 | ✅ 归因后修复 |
| `integration_error` | 集成测试失败 | ⚠️ 归因后尝试，失败升级 |
| `coverage_insufficient` | 覆盖率不达标 | ✅ 补测试 |
| `architecture_mismatch` | 设计违反约束 | ❌ 升级人工 |
| `requirement_ambiguity` | 需求歧义 | ❌ 升级人工 |
| `performance_regression` | 性能退化 | ⚠️ 视情况处理 |

## 输出契约

### 单轮迭代输出（IterationResult）

由 core 类型定义（见 `core/scripts/types.ts`）。本方向具体字段映射：

```yaml
iteration: 3
status: failed
evaluation:
  hard_gates:
    - { gate: lint, passed: true }
    - { gate: typecheck, passed: true }
    - { gate: test, passed: false, detail: "2/15 tests failed" }
  hard_gates_all_passed: false
  weighted_score: 0
diagnosis:
  category: test_failure        # M0 阶段省略,M1 启用
  reason: "fizzbuzz(15) returned 'FizzBuzz' but expected 'FizzBuzz' — off-by-one in modulo"
  evidence:
    - "FAIL test/fizzbuzz.test.ts > divisible by 15"
changed_files:
  - src/fizzbuzz.ts
commit_sha: a1b2c3d
next_action: retry
```

### 终态产物

core 在 `<workspace>/.letsgoal/` 下维护以下文件：

| 文件 | 格式 | 更新时机 | 用途 |
|------|------|---------|------|
| `task-state.json` | JSON | 每轮更新 | 当前 LoopTask 完整状态，支持 resume |
| `iterations.jsonl` | JSON Lines | 每轮追加 | 全部 `IterationResult` 历史 |
| `iterations/iter-N.log` | 文本 | 每轮写入 | 第 N 轮 executor 子进程的完整日志 |
| `final-report.md` | Markdown | 终态时写入 | 终态汇报（成功/失败、最佳轮次、产物列表） |

此外每轮产生一次 Git commit，message 格式 `letsgoal(iter-N): <description>`。

## 与 core 的对接

本方向通过实现 `DirectionAdapter`（见 `core/scripts/types.ts`）接入循环引擎：

```typescript
// directions/development/scripts/adapter.ts
export const developmentAdapter: DirectionAdapter = {
  direction: "development",
  plan,        // 解析 + 校验 + 准备 workspace
  execute,     // 调用 executor.ts spawn claude -p
  evaluate,    // 调用 evaluator.ts 跑三件套
  diagnose,    // 调用 diagnose.ts 整理失败原因
  report,      // 简短文本汇报
};
```

`core/scripts/self_loop.ts` 通过 `--direction development` 加载此 adapter。

## M1 范围

**做**:
- 9 类归因分类器（classifier.ts），规则优先，LLM 兜底（可选）
- Diagnosis.category 字段填充，category 感知的修复策略注入 executor prompt
- architecture_mismatch / requirement_ambiguity → escalate
- 评测集版本冻结（eval_suite.ts），SHA-256 哈希校验
- Skill 创建场景（skill_creation task_type）：skill_syntax / skill_eval 门禁
- Skill 优化场景（skill_optimize task_type）：冻结评测集 + 优化专用 prompt
- Skill 创建/优化 executor prompt 模板
- 非硬门禁门禁失败不影响 pass/fail 判定（adapter 修复）
- F4 / F5 fixture（Skill 创建/优化）
- vitest 测试基础设施

**不做**:
- 加权软分（仍用硬门禁通过/不通过）
- LLM 归因分类（预留接口，默认关闭）
- 覆盖率门禁（M2）
- e2e 门禁（M2）
- 渐进式自主（只有 standard 模式）
- 飞书通知 / 飞书表格

## M0 范围

**做**:
- DevTaskRequest 解析与默认值填充
- 三件套 evaluator（lint / typecheck / test），按命令发现策略找命令
- executor 通过 `claude -p` spawn Claude Code 完成代码生成/修复
- diagnose 把 stderr 摘要转为 `Diagnosis.reason`（自由文本，不分类）
- 单轮 commit 写入 git，message 格式 `letsgoal(iter-N): <description>`
- 跨轮记忆从 `task-state.json` + `iterations.jsonl` 读取，git log 作为 executor prompt 的辅助上下文
- 3 个白盒 fixture，见 [`fixtures/`](fixtures/)

**不做**:
- 加权软分（全用硬门禁通过/不通过）
- 归因分类
- 覆盖率门禁
- e2e 门禁
- 渐进式自主（只有 standard 模式）
- 飞书通知 / 飞书表格
- Skill 创建场景（M1）

## 红线（本方向特有）

执行循环过程中即使 auto-accept 也必须停下来问的动作：

- 修改 `forbidden_changes` 中列出的文件
- 修改 `.env` / 密钥 / CI 配置
- 数据库 schema 变更
- 删除任何已 commit 的代码（必须通过 revert 而非物理删除）
- 跨 fixture 边界改动（直接改 fixture 配置去通过门禁，而非改业务代码）
- 给评估器降级以"绕过"失败（例如把 fail 测试改成 skip）

## 评估器契约

evaluator.ts 必须实现以下接口：

```typescript
export interface EvaluatorRunResult {
  command: string;            // 实际执行的命令
  exit_code: number;
  passed: boolean;            // 退出码 0 即通过
  duration_ms: number;
  stdout_tail: string;        // 末尾 100 行
  stderr_tail: string;        // 末尾 100 行
  parsed_failures?: string[]; // 失败的具体测试/检查项(M1 引入)
}

export interface EvaluatorResult {
  lint?: EvaluatorRunResult;
  typecheck?: EvaluatorRunResult;
  test?: EvaluatorRunResult;
  skill_syntax?: EvaluatorRunResult; // M1: Skill 格式校验
  skill_eval?: EvaluatorRunResult;   // M1: Skill eval case 通过率
  // 缺失字段表示"该命令未发现,本门禁 skip"
}
```

evaluator 不得修改任何文件，只读取项目状态。
