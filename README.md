# LetsGoal

目标导向的 Agent 自循环框架。用户给出目标和成功标准，系统自主完成 **Plan → Execute → Evaluate → Repair → Report** 五阶段闭环，仅在关键决策点引入人工。

## 痛点 & 洞察

当前 AI 辅助的典型工作模式：

```
目标 → AI 规划/执行 → 人工检查 → 反馈纠偏 → AI 再执行 → ... → 人工验收 → 完成
```

人工在整个过程中基本处于值守状态，随时待命响应反馈，非常低效。但回顾人工在其中的实际作用，主要分两类：

| 类型 | 开发调试 | 数据采集 | 模型调优 | 性质 |
|------|---------|---------|---------|------|
| **操作反馈** | 试跑验证、报错反馈 | 检查采集结果、补采指令 | 检查评测结果、重跑指令 | 机械性，只是闭合反馈环 |
| **方向把控** | 方案 review、路线选择 | 采集目标定义、验收标准 | 调优方向、人工归因纠正 | 需要判断力，体现人的价值 |

**核心洞察**：操作反馈类的工作，人在其中几乎是机械的中转站——完全可以自动化。真正需要人的是方向把控。当前提效瓶颈在于：过程不可追溯 → 不敢放手 → 只能值守 → 介入了又信息不足 → 效率低，形成恶性循环。

## 目标 & 思路

构建目标导向的 Agent 自循环框架——用户只需给出目标和成功标准，系统自主完成规划、执行、评估、修正和汇报，仅在关键决策点引入人工判断。

```
Plan（规划）→ Execute（执行）→ Evaluate（评估）→ Repair（修复）→ Report（汇报）
```

**核心设计原则**：

1. **操作反馈自动化** — 试跑、验证、修 bug 等机械性闭环由系统自动完成
2. **方向把控聚焦** — 人工只在方案 review、路线选择等关键决策点介入
3. **过程可追溯** — 阶段性结论结构化记录，过滤过程噪音
4. **主动通知** — 需要人关注时主动推送，附带决策所需上下文和选项

## 方案设计

### 自循环引擎

五阶段闭环，三个方向通用：

```
用户输入目标 + 成功标准
  ↓
Plan     解析目标 → 结构化任务定义 → 确认评估标准
  ↓
Execute  调用方向配置的工具执行
  ↓
Evaluate 对照标准评估结果（L0→L1→L2→L3 逐层晋级）
  ↓
  ├─ 通过 → Report
  └─ 失败 → Repair
              ↓
         归因 → 修复 → 回到 Evaluate
              ↓
         无法修复 → Report（升级人工）
  ↓
Report   推送摘要；判断是否需要人工决策
  ↓
  ├─ 通过 → 完成
  └─ 需要继续 → 回到 Execute
```

### 三个方向

共享同一引擎，差异通过方向配置承载：

| 维度 | 开发调试 | 数据采集 | 模型调优 |
|------|---------|---------|---------|
| 评估重点 | 测试/lint/类型/效果 | 条数/字段/时效 | 成功率/指标/副作用 |
| 修复策略 | 修bug→重构→补测试 | 重试→补采→降级 | 自动调优→回滚 |
| 产物 | 代码 commit + 测试报告 | JSONL + 报告 | Skill/Prompt + 评测报告 |

- **开发调试**（✅ M1-M4 可用）：需求 → 编码 → 验证 → 修复
- **数据采集**（⏳ M5 规划）：目标 → 采集 → 校验 → 补采
- **模型调优**（⏳ M6 规划）：评测集 → 评测 → 归因 → 调优

完整设计文档见 [`docs/design.md`](docs/design.md)。

## QuickStart

### 使用

在 Claude Code 终端或飞书机器人中调用 `/letsgoal`，描述目标即可：

```
/letsgoal 实现 fizzbuzz 函数，通过所有测试用例
```

也可以在对话中提供任务文件，系统自动解析：

```
/letsgoal 开始执行任务 @request.md
```

系统自动进入 Plan → Execute → Evaluate → Repair → Report 闭环，仅在关键决策点通知你。

### 任务文件格式

见 `directions/development/templates/request.md`。关键字段：

```markdown
## 目标
实现 fizzbuzz 函数，通过所有测试用例。

## 项目根目录
/home/user/projects/my-app

## 约束
- 使用 JavaScript
- 不引入新的运行时依赖

## 禁止改动
- package.json
- test/

## 配置
task_type: feature
language: javascript
success_criteria:
  hard_gates: [test]
loop_config:
  max_iterations: 3
```

### 开发

```bash
npm install          # 安装依赖
npm run check        # 编译检查
```

## 文档索引

- [`CLAUDE.md`](CLAUDE.md) — 项目工作规范与红线
- [`SKILL.md`](SKILL.md) — Claude Code Skill 定义与调用方式
- [`docs/design.md`](docs/design.md) — 完整产品设计文档
- [`docs/roadmap.md`](docs/roadmap.md) — 路线图与进展跟踪
- [`core/references/loop-protocol.md`](core/references/loop-protocol.md) — 五阶段协议文档
- [`directions/development/DIRECTION.md`](directions/development/DIRECTION.md) — 开发调试方向定义
