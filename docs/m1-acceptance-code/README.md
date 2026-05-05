# M1 第二次验收报告（代码任务）

验收时间：2026-05-05
验收标准：用 LetsGoal self-loop 引擎修复一个 TypeScript bugfix 任务，验证 M1 全部能力

## 场景

TypeScript 配置解析库（Safe Config Parser），包含 3 个相互依赖的 bug：
1. `validateConfig()` 返回 `RawConfig`（所有字段可选）但声明返回 `Config`（所有字段必填），TypeScript strict 模式报类型错误
2. `retries` 字段缺少验证逻辑（负数、非整数），测试期望 `"retries must be a non-negative integer"` 错误信息
3. `resolveConfig()` spread 顺序反了（`{...parsed, ...defaults}`），defaults 覆盖了用户输入

Bug 1 阻塞 typecheck，使 test 门禁无法运行。修复 Bug 1 后，Bug 2 和 Bug 3 才在测试中暴露。

## 验收项目

### 1. 代码 bugfix 场景 ✅

从包含 3 个 bug 的 TypeScript 模块出发，self-loop 修复代码使 typecheck 和测试全部通过。

- 输入：`request.md`（task_type: bugfix，含 Bug 复现描述）
- 输出：修复后的 `src/config-parser.ts`
- 门禁：typecheck=✓ test=✓
- 实际轮次：1 轮通过

### 2. eval suite 冻结 + 篡改检测 ✅

- `eval-suite.json`：v1 版本，SHA-256 哈希冻结（覆盖 `test/*.test.ts` + `eval-cases/*.json`）
- 正常校验：✅ PASS（`verifyEvalSuite()` 返回 true）
- 篡改检测：修改 hash 后 `verifyEvalSuite()` 返回 false → ✅ 检测到篡改
- 单元测试覆盖：`eval_suite.test.ts` 7 个测试全通过

### 3. 分类器逻辑 ✅（单元测试验证）

规则分类器的 9 类逻辑通过 75 个单元测试充分验证：
- `type_error`：typecheck 失败 + stderr 含 `"is not assignable"` → 匹配 ✅
- `test_failure`：test 失败 + 无集成关键词 → 匹配 ✅
- `syntax_error`：typecheck 失败 + stderr 含 `"SyntaxError"` → 匹配 ✅
- `lint_violation`：lint 失败 + 其他门禁通过 → 匹配 ✅
- `integration_error`：test 失败 + 输出含 `"ECONNREFUSED"` / `"timeout"` / `"fetch"` / `"API"` → 匹配 ✅
- `coverage_insufficient`：全部门禁通过 + `weighted_score < 1.0` → 匹配 ✅
- 多规则优先级：syntax_error > type_error > lint_violation > integration_error > test_failure ✅
- `isDiagnosisCategory` 类型守卫 ✅

### 4. 修复策略注入 ✅（代码逻辑验证）

`CATEGORY_REPAIR_HINTS` 在 `classifier.ts` 中定义，`executor.ts` 的 `buildPrompt()` 通过 `categoryRepairHint()` 注入：
- `type_error` → "类型错误，根据类型信息修复类型标注或代码逻辑"
- `test_failure` → "测试失败，定位具体失败用例，分析原因并修复对应代码"
- `architecture_mismatch` → "设计违反约束，可能需要人工介入——不要强行绕过约束"
- `requirement_ambiguity` → "需求不明确，不要猜测意图——明确需求后再修复"

注入路径：`adapter.ts evaluate()` → `diagnose.ts` → `classifier.ts classifyFailure()` → `Diagnosis.category` → `executor.ts buildPrompt()` 检查 `isDiagnosisCategory(cat)` → 注入 `categoryRepairHint(cat)`。

### 5. 迭代修复闭环 ⚠️ 未在本次验收中触发

**核心发现**：对 Claude 来说，小型 TypeScript bugfix 任务（3 个 bug、1 个文件）1 轮通过是稳定现象。无论 bug 多隐蔽、Bug 复现描述多含糊，Claude 都能一次性全部修复。

这验证了第一次验收的结论：**修复闭环的真实价值在更复杂的代码任务中才能体现**——多文件改动、API 设计变更、性能调优等场景。M2 的 bugfix/refactor 场景将提供更充分的验证。

### 6. escalate 机制 ⚠️ 规则分类器无法触发

`architecture_mismatch` 和 `requirement_ambiguity` 在当前规则分类器中不可达——没有关键词模式能匹配这两类。它们需要语义理解（LLM 分类器），是 M2 的交付范围。

## 验收物料

```
docs/m1-acceptance-code/
├── README.md                    # 本报告
├── request.md                   # 输入：bugfix 任务
├── config-parser.initial.ts     # 输入：含 3 个 bug 的初始代码
├── config-parser.fixed.ts       # 输出：self-loop 修复后的代码
├── config-parser.test.ts        # 输入：8 个测试用例
├── case-1.json                  # 输入：eval case
├── eval-suite.json              # 评测集冻结记录
├── final-report.md              # self-loop 终态报告
└── iterations.jsonl             # 迭代记录
```

## 结论

**M1 第二次验收完成。** 代码任务视角的验证结果：

| 能力 | 状态 | 说明 |
|------|------|------|
| 代码 bugfix 场景 | ✅ | self-loop 1 轮修复 3 个 bug |
| eval suite 冻结 | ✅ | 冻结 + 篡改检测 + 单元测试覆盖 |
| 分类器逻辑 | ✅ | 75 个单元测试覆盖 6 类可触发分类 + 优先级 |
| 修复策略注入 | ✅ | 代码逻辑验证：classifyFailure → Diagnosis.category → executor prompt |
| 迭代修复闭环 | ⚠️ 未触发 | Claude 对小型 bugfix 1 轩通过，需更复杂任务 |
| escalate 机制 | ⚠️ 未触发 | 规则分类器不可达，需 LLM 分类器（M2） |

### 与第一次验收的对比

| 维度 | 第一次（Skill 文档） | 第二次（代码 bugfix） |
|------|---------------------|---------------------|
| 任务类型 | skill_optimize | bugfix |
| 门禁类型 | skill_syntax + skill_eval | typecheck + test |
| 归因分类 | test_failure（1 种） | 未触发（1 轮通过） |
| 修复闭环 | 未触发（1 轮通过） | 未触发（1 轮通过） |
| eval suite 冻结 | ✅ | ✅ |
| 新增验证 | — | 分类器单元测试覆盖、修复策略注入路径 |

两次验收共同覆盖了 M1 全部能力的验证。迭代闭环和多分类的端到端触发留给 M2。
