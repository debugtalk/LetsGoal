# LetsGoal

目标导向的 Agent 自循环框架。用户给出目标和成功标准，系统自主完成 **Plan → Execute → Evaluate → Repair → Report** 五阶段闭环，仅在关键决策点引入人工。

覆盖三个方向（共享同一引擎，差异通过方向配置承载）：

- **开发调试**（✅ M0 可用）：需求 → 编码 → 验证 → 修复
- **数据采集**（⏳ M3+ 规划）：目标 → 采集 → 校验 → 补采
- **模型调优**（⏳ M3+ 规划）：评测集 → 评测 → 归因 → 调优

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译检查
npm run check
```

## 项目结构

```
LetsGoal/
├── core/                      # 共享自循环引擎
│   ├── scripts/               # parse_request / self_loop / types
│   └── references/            # 协议文档（loop-protocol.md）
│
├── directions/                # 三个方向
│   ├── development/           # 开发调试（M0 已实现）
│   │   ├── scripts/           # adapter / executor / evaluator / diagnose
│   │   ├── templates/         # request.md 输入模板
│   │   └── fixtures/          # F1/F2/F3 白盒验收用例
│   ├── data-collection/       # 数据采集（M3+）
│   └── model-tuning/          # 模型调优（M3+）
│
├── docs/design.md             # 完整产品设计文档
├── SKILL.md                   # Claude Code Skill 定义
├── CLAUDE.md                  # 项目工作规范
└── README.md                  # 本文件
```

## 使用方式

### CLI

```bash
npm run self-loop -- \
  --direction development \
  --input request.md \
  --workspace ./workspace
```

参数：
- `--direction`：方向（M0 仅支持 `development`）
- `--input`：Markdown 任务文件路径
- `--workspace`：工作目录（状态文件写入 `.letsgoal/`）
- `--dry-run`：解析 + plan 后退出，不进入主循环

### 输入模板

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

## 文档索引

- [`CLAUDE.md`](CLAUDE.md) — 项目工作规范与红线
- [`SKILL.md`](SKILL.md) — Claude Code Skill 定义与调用方式
- [`docs/roadmap.md`](docs/roadmap.md) — 路线图与进展跟踪
- [`docs/design.md`](docs/design.md) — 完整产品设计文档（痛点、方案、三方向规划）
- [`core/references/loop-protocol.md`](core/references/loop-protocol.md) — 五阶段协议文档
- [`directions/development/DIRECTION.md`](directions/development/DIRECTION.md) — 开发调试方向定义
