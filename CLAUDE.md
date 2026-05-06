# LetsGoal 项目规范

> 本文件是 LetsGoal 项目特有的工作约定，与 `notes/CLAUDE.md` 互补，不重复其中已有内容。

## 项目定位

目标导向的 Agent 自循环框架。用户给出目标和成功标准，系统自主完成 Plan → Execute → Evaluate → Repair → Report 五阶段闭环，仅在关键决策点引入人工。

覆盖三个方向（共享同一引擎，差异通过方向配置承载）：

- **开发调试** (`directions/development/`）：需求 → 编码 → 验证 → 修复
- **数据采集** (`directions/data-collection/`）：目标 → 采集 → 校验 → 补采
- **模型调优** (`directions/model-tuning/`）：评测集 → 评测 → 归因 → 调优

## 目录结构约定

```
LetsGoal/
├── README.md                  # 整体框架说明（对外）
├── CLAUDE.md                  # 本文件（项目规范，对内）
├── SKILL.md                   # letsgoal skill 入口（被 Claude Code 加载）
├── package.json               # 统一 npm 项目
├── tsconfig.json
│
├── core/                      # 共享自循环引擎（三方向通用）
│   ├── scripts/               # parse_request / self_loop / types
│   └── references/            # 协议文档（loop-protocol）
│
├── directions/                # 三个方向
│   ├── development/           # 开发调试
│   │   ├── DIRECTION.md       # 方向定义：hard gates、归因、模板
│   │   ├── scripts/           # 方向特有：executor / evaluator / diagnose
│   │   ├── templates/         # 输入模板
│   │   └── fixtures/          # 白盒验收用例
│   ├── data-collection/       # 数据采集
│   └── model-tuning/          # 模型调优（占位）
└── docs/                      # 设计文档与路线图
```

### 设计原则

1. **共享在 core/，差异在 directions/**：任何三方向通用的逻辑必须放 core，不允许在 directions 内重复实现 self-loop 引擎、状态管理、版本号、归因协议
2. **方向通过 DIRECTION.md 描述差异**：hard gates、归因分类、输入输出契约、特有脚本入口
3. **方向脚本可调用 core，反之不允许**：依赖方向单向。core 不感知具体方向

## 开发语言与工具栈

- **主语言**：TypeScript（Node.js >= 20）
- **构建**：tsc（无打包，直接 `node --import tsx` 或编译后运行）
- **运行**：npm scripts
- **测试**：vitest（M1 暂不引入，有需要时再加）
- **被 LetsGoal 调度的目标项目**：任意语言（通过命令行调用 ruff/pytest/cargo/golangci-lint 等）

## 验证要求

每次改动后必须自检通过：

```bash
npm run check        # tsc --noEmit + 关键脚本 dry-run(M1 暂只有 tsc)
```

M1 阶段不强制单元测试，但每个 fixture 必须能在 `max_iterations=3` 内通过验收。

## 红线（项目特有，补充 notes/CLAUDE.md）

以下操作即使在 auto-accept 模式下也必须停下来问：

- 修改 `core/scripts/types.ts` 中已被多处引用的共享类型（影响所有方向）
- 修改 `core/scripts/self_loop.ts` 主流程（影响所有方向的循环行为）
- 修改 `core/references/loop-protocol.md` 五阶段协议
- 删除或重命名 `directions/*/DIRECTION.md`（方向契约）

## 工作纪律（LetsGoal 项目特有）

- 任何 PR 必须更新对应 DIRECTION.md 或 loop-protocol.md（代码契约同步）
- 三方向有重复需求时，先抽到 core，不允许复制粘贴
- fixture 一旦合并，改动需要同步说明改了什么、为什么改
- 共享类型字段命名遵循 snake_case，避免类型层的 camelCase/snake_case 双轨

## 排版规范

中文文本中的标点使用全角符号，不使用英文半角：

| 英文半角 | 中文全角 |
|----------|----------|
| `,` | `，` |
| `:` | `：` |
| `;` | `；` |
| `(` `)` | `（` `）` |

例外：代码块、行内代码、URL、文件路径、纯英文段落中的半角标点保持不变。

## 术语表（LetsGoal 项目内统一）

| 统一用 | 不混用 |
|--------|--------|
| 自循环 / self-loop | 自动迭代 / auto-iterate |
| 方向 / direction | 场景 / 子项目 / 模块 |
| 硬门禁 / hard gate | 必过项 / 卡点 / 阻塞条件 |
| 加权软分 / weighted score | 总分 / 综合得分 |
| 迭代轮 / iteration | 轮次 / round / cycle |
