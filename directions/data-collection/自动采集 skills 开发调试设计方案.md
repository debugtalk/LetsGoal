# DataClaw 自动采集 Skills 开发调试设计方案

## 1. Executive Summary

DataClaw 是一套以 Hermes Agent + 飞书机器人为入口的通用自动采集 skill 创建、评测、运行观测和持续调优平台。

用户通过飞书 `/dataclaw` 指令提交结构化 Markdown 需求，并可附带截图、页面样例、接口样例、历史产物或金标数据。系统先生成评测集草案并写入飞书多维表格供用户 review。用户确认后冻结当前评测集版本，再基于 `skill-creator` 创建标准 skill，并通过离线评测 + 真实环境端到端评测自循环迭代，直到达标或达到最大优化次数。

视频平台 Android App 榜单采集只是首个 MVP 示例场景。整体能力需要保持场景无关，可扩展到 App、Web、API、文件处理、内部系统操作和多源数据采集。

核心设计要点：

- 产品载体是独立的 **DataClaw Hermes App / Tool**，负责常驻服务、状态机、任务队列、监听、轮询、定时任务和 worker 调度。
- Agent 侧流程知识沉淀为 **`dataclaw-skill-builder` 总控 skill**，负责指导需求解析、评测集生成、skill 创建、自循环调优和反馈处理。
- 飞书主入口是显式 `/dataclaw` 命令，自然语言作为兜底并归一化到同一任务协议。
- 所有飞书文档、飞书多维表格、飞书表格、附件和消息交互统一通过 `lark-cli`。
- 用户可在需求中指定优先复用的 CLI/skills，例如 `uixt`、`android-adb`、`skill-creator`。
- 评测集采用版本化冻结：一次优化任务绑定固定 `eval_suite_version`；目标或金标数据变化时创建新版本。
- 自循环全过程可观测，每轮执行记录、产物、diff、失败归因和用户评论都写入飞书表格。
- MVP 阶段状态源优先使用飞书多维表格；如需本地持久化，先用文件存储简化实现。
- 自循环迭代过程中允许 agent 自行修改 skill 和脚本，不需要每轮人工批准；最终发布到 skills 平台前由人工确认。
- 生成的 skill 存放在 `EvalSkills` 仓库中；每次修改都自增小版本号后缀。
- 首版默认执行器使用 ClaudeCode。
- 产品同时支持 `Build Mode` 和 `Operate Mode`：前者用于首次创建/大改 skill，后者用于日常运行观测和持续调优。

## 2. Scope and Reading Rules

本文按“通用产品能力 + MVP 落地约束”两层描述：

- 通用产品能力：DataClaw 应能支持 App、Web、API、文件处理、内部系统操作和多源数据采集等更多场景，不绑定视频榜单。
- MVP 落地约束：首版只实现视频榜单采集，用该场景验证需求输入、评测集 review、skill 创建、自循环优化、运行观测和飞书交互闭环。
- 具体实现约束落入对应章节：状态源见 Feishu Workspace Model，版本号和发布见 Skill Bootstrap，自循环权限见 Self-Loop Iteration，执行器见 Worker Execution Architecture，日常异常优化见 Product Modes。

## 3. Product Architecture

### 3.1 双层载体

```text
飞书用户入口
  -> /dataclaw 命令
  -> Carrier 层（Hermes Agent / OpenClaw / nanobot / ...）
  -> 加载 dataclaw-skill-builder 总控 skill
  -> 调度 lark-cli / skill-creator / uixt / android-adb / worker agents
```

**Carrier 层**（Hermes Agent / OpenClaw / nanobot 等）

对外产品载体，承担常驻服务和系统工程能力。Carrier 是可替换的，skill 不依赖特定 carrier 实现：

- 飞书机器人入口。
- `/dataclaw` 命令解析。
- 任务队列和长任务状态机。
- 持久化状态存储。
- 定时 Daily Runs。
- 飞书事件监听。
- 评论轮询和幂等消费。
- worker 调度、并发控制和失败恢复。
- 审计记录和权限边界。

MVP 阶段，Carrier 以飞书多维表格作为主要状态源；如需本地持久化，仅使用本地文件保存任务状态快照、worker lease、评论消费记录和同步游标，暂不引入内部数据库。Carrier 的具体实现可以是 Hermes Agent、OpenClaw、nanobot 或任何具备网关常驻能力的框架。dataclaw-skill-builder 不实现网关、队列、调度或事件路由——这些职责完全由 Carrier 承担。

**轻量直连模式**

除了常驻 Carrier 框架外，DataClaw 还支持轻量直连模式：通过 `@larksuiteoapi/node-sdk` WebSocket 长连接监听飞书事件，直接 spawn Claude Code CLI 作为 Carrier + Worker。此模式无需部署独立的 Carrier 框架，适合 MVP 快速验证和小规模使用。详细设计见 `references/feishu-gateway.md`。

**`dataclaw-skill-builder` 总控 skill**

Agent 侧能力载体，沉淀业务流程知识：

- 解析采集需求。
- 生成评测集。
- 写入飞书表格 review。
- 基于 `skill-creator` 创建标准 skill。
- 冻结评测集。
- 执行自循环优化。
- 处理用户反馈。
- 判断是否创建新 eval suite version。
- 选择和调度 `lark-cli`、`uixt`、`android-adb` 等能力。

目录结构：

```text
dataclaw-skill-builder/
├── SKILL.md                          # Skill 定义：触发条件、流程、Carrier 对接指引
├── package.json                      # npm scripts 入口（14 个命令）
├── tsconfig.json                     # TypeScript 配置
├── references/
│   ├── design-spec.md                # 完整设计方案 + 实现进展
│   ├── eval-suite-design.md          # 评测集生命周期、分层、MVP 评分
│   ├── feishu-tables.md              # 7 表 schema 与字段定义
│   ├── feedback-consumption.md       # 反馈来源、幂等键设计、状态机
│   ├── worker-protocol.md            # Worker 角色、patch mode、迭代记录
│   └── build-operate-modes.md        # Build/Operate 模式规则与异常阈值
├── scripts/
│   ├── dataclaw_common.ts            # 共享类型定义 + 工具函数
│   ├── parse_request.ts              # Markdown → SkillCreationRequest
│   ├── generate_eval_suite.ts        # L0-L3 + hard gates + score_weight
│   ├── build_workflow.ts             # 编排：parse → generate eval → review → freeze/bootstrap
│   ├── bootstrap_skill.ts            # 标准目录 + SKILL.md + references + scripts + evals + dataclaw.json
│   ├── self_loop.ts                  # 自循环主流程：bootstrap → run → judge → patch → retry
│   ├── judge_iteration.ts            # 硬门禁 + 加权软分
│   ├── patch_worker.ts               # mvp-mock / claude-code 双 patch mode
│   ├── patch_apply.ts                # 外部 patch 后记录：版本自增 + 迭代记录
│   ├── bump_version.ts               # v<major>.<minor>.<patch>.<revision> 自增
│   ├── record_iteration.ts           # 写入 iterations/ 目录
│   ├── feishu_prepare.ts             # 7 表 schema + 建表 + 写入命令生成
│   ├── feishu_poll.ts                # 轮询评论/review/反馈消费状态命令生成
│   ├── consume_feedback.ts           # 评论分类 + agent 决策 + 幂等消费 + lark-cli 回写
│   └── daily_run.ts                  # Operate Mode：运行 + judge + 异常检测 + 飞书写入
├── evals/
│   ├── evals.json                    # 5 条端到端评测定义
│   └── fixtures/
│       ├── tencent-video-hotlist-request.md   # MVP fixture：腾讯视频榜单需求
│       └── passing-summary.json               # 完美通过 fixture：30/30 items
└── .dataclaw/
    └── hermes/                       # Carrier 集成占位（暂空，Carrier 层不在此实现）
```

**Generated Collector Skills**

每个具体采集场景最终生成独立业务 skill，例如：

- `video-hotlist-crawler`
- `web-price-crawler`
- `internal-report-fetcher`
- 其它 App / Web / API / 文件 / 内部系统采集 skill

### 3.2 组件职责

| 组件 | 职责 |
|---|---|
| Carrier（Hermes Agent / OpenClaw / nanobot / 轻量直连网关） | 常驻入口、队列、状态机、定时任务、飞书事件、评论轮询 |
| `dataclaw-skill-builder` | 流程知识、评测集生成、skill 创建规范、自循环策略 |
| Generated Skills | 具体采集场景的执行说明和脚本 |
| Worker Agents | 代码修改、运行评测、控制环境、执行采集 |
| Feishu Worker | 统一通过 `lark-cli` 操作飞书文档、表格、附件、消息 |
| `lark-cli` | 所有飞书交互的唯一工具通道 |
| `uixt` / `android-adb` | Android UI 自动化和设备控制示例能力 |

## 4. Product Modes

### 4.1 Build Mode

用于从零创建或大改 skill：

```text
用户提交需求
 -> Hermes 解析为 SkillCreationRequest
 -> 生成评测集草案
 -> 写入飞书表格 review
 -> 用户确认并冻结 eval_suite_version
 -> 基于 skill-creator 创建初版 skill
 -> 自循环优化到达标或达到最大轮次
 -> 返回 skill、评测报告和产物
```

默认约束：

- `max_iterations` 默认为 `10`，用户可在 Markdown 需求中覆盖。
- `min_score` 默认为 `0.92`，具体场景模板可按风险调整。
- 自循环阶段可以自动修改 skill 内容和脚本，不需要每轮人工批准。
- 自循环通过后只产出候选 skill 版本，最终发布到 skills 平台前必须人工确认。

适用场景：

- 新平台。
- 新采集场景。
- 新字段/新输出格式。
- 目标系统链路发生大变化。

### 4.2 Operate Mode

用于日常运行观测和持续调优：

```text
定时执行 skill
 -> 记录运行过程到 Daily Runs
 -> 监测成功率、耗时、条数、字段质量和失败类型
 -> 达到触发条件时生成问题汇总和优化建议
 -> 推送飞书消息给用户确认
 -> 用户确认后进入 Build Mode 风格的自循环优化
```

日常运行不应每次都自动优化，也不在 MVP 阶段无人确认地自动修改代码。异常发生时先生成问题汇总和优化建议，由用户确认后再进入自循环优化。

日常异常优化采用“建议先行、确认后执行”的策略：

- DataClaw 先在 `Daily Runs` 中记录异常、失败归因、产物和优化建议。
- Hermes 通过飞书消息推送问题汇总，并提供“启动优化 / 暂不处理 / 查看详情”等动作。
- 用户确认后，系统基于最近运行产物和当前冻结评测集创建优化任务。
- 未经用户确认时，MVP 不启动无人值守的代码修改。

触发条件示例：

- 连续 N 次失败。
- 条数低于阈值。
- 同一失败原因重复出现。
- 目标系统 UI 或接口疑似改版。
- 用户在运行记录中标记“需要优化”。
- 定期健康检查发现分数下降。

## 5. Feishu Interaction

### 5.1 `/dataclaw` 命令

飞书主入口推荐使用显式 `/dataclaw`：

```text
/dataclaw create
/dataclaw create --from-doc <feishu-doc-url>
/dataclaw status <task_id>
/dataclaw latest <task_id>
/dataclaw artifacts <task_id>
/dataclaw pause <task_id>
/dataclaw resume <task_id>
/dataclaw stop <task_id>
/dataclaw retry <task_id>
/dataclaw operate enable <skill_name>
/dataclaw operate status <skill_name>
```

自然语言可以作为兜底，例如”帮我创建一个腾讯视频榜单采集 skill”。Hermes 识别后仍归一化到 `/dataclaw create` 的内部任务协议。复杂任务建议使用显式命令，减少误触发和上下文丢失。

飞书文档也可作为需求输入源。用户通过 `/dataclaw create --from-doc <url>` 传入飞书文档 URL，系统通过 `lark-cli docs +fetch` 读取文档内容为 Markdown，然后进入标准流程。文档格式建议遵循 §6.1 的 Markdown 模板；如不符合，Claude Code 可先重组为模板格式再解析。

多任务场景下，控制命令优先要求显式携带 `task_id`。单聊且只有一个活跃任务时可以使用最近任务兜底；群聊、并行任务或存在歧义时，Hermes 应返回候选任务列表并要求用户指定 `task_id`，避免误暂停、误重跑或误终止其它任务。

### 5.2 状态查询和控制

自循环过程中支持飞书消息主动查询状态和进展。

被动推送示例：

```text
第 3/10 轮完成
当前分数：0.86
硬门禁：rank 连续通过，条数未达标
失败原因：疑似停留在预览榜单
下一步：调整导航进入完整榜单
详情：<飞书表格链接>
```

主动查询示例：

```text
进展如何？
当前跑到第几轮？
上一轮为什么失败？
现在有哪些产物？
暂停任务
继续任务
重跑上一轮
```

Hermes 将自然语言映射到标准动作，然后查询任务状态、`Iteration Runs`、`Artifacts` 和当前 worker 状态，返回摘要。

### 5.3 反馈渠道

不同阶段使用不同反馈入口：

| 阶段 | 主反馈入口 | 说明 |
|---|---|---|
| 评测集 review | `Eval Cases.user_feedback` + `review_status` | 一行一个 case，便于结构化读取和状态流转 |
| 自循环迭代 | `Iteration Comments` 表 | 绑定 run/case，支持幂等消费和 agent 决策 |
| 即时控制 | 飞书对话或卡片按钮 | 暂停、继续、终止、重跑、查询状态 |
| 长文档审阅 | 飞书文档评论 | 只作为补充，不作为主流程数据源 |

## 6. User Input Contract

### 6.1 Markdown 输入模板

飞书交互层推荐使用结构化 Markdown，系统内部解析为 `SkillCreationRequest` JSON。

需求输入支持两种方式：

1. **本地 Markdown 文件**：用户直接提供或粘贴 Markdown 内容，保存为 `request.md` 后传入 `--input`
2. **飞书文档 URL**：用户传入飞书文档链接，系统通过 `lark-cli docs +fetch` 读取文档内容为 Markdown，再进入标准解析流程。支持 `/docx/<id>` 和 `/wiki/<token>` 两种 URL 格式。飞书表格（`/sheets/`）不支持作为需求输入

```markdown
# 自动采集 Skill 创建需求

## 目标
创建腾讯视频电视剧热播榜采集 skill。

## 目标系统信息
- 平台名称：腾讯视频
- App 包名：com.tencent.qqlive
- 系统类型：Android App
- 访问方式：真机 UI 自动化

## 操作链路
1. 打开 App 首页
2. 点击顶部搜索框
3. 进入搜索页榜单区域
4. 点击查看完整榜单
5. 切换到电视剧热播榜

## 采集目标
- 采集对象：电视剧榜单条目
- 预期条数：30
- 输出格式：JSONL

## 字段要求
- platform_name
- rank
- catalog_name
- catalog_type
- release_date
- tag
- collected_date

## 约束要求
- rank 从 1 开始连续
- 只采集完整榜单，不采集预览卡片
- 失败时保留 partial output 和 summary
- 结束时必须 force-stop App

## 评测要求
- 最大迭代次数：10
- 通过分数：0.92
- 是否需要真实环境端到端评测：是

## 指定复用能力
- CLI：uixt, android-adb
- Skills：skill-creator, android-adb, uixt
- 复用要求：优先调用已有 CLI/skill，不重复实现 Android 设备控制和 UI 自动化能力

## 附件说明
- 已上传首页、搜索页、完整榜单页、底部触底截图
```

### 6.2 内部结构化请求

```json
{
  "skill_goal": "创建腾讯视频电视剧热播榜采集 skill",
  "target_system": {
    "name": "腾讯视频",
    "type": "Android App",
    "app_package": "com.tencent.qqlive",
    "access_method": "real_device_ui_automation"
  },
  "scenario_chain": [
    "打开 App 首页",
    "点击顶部搜索框",
    "进入搜索页榜单区域",
    "点击查看完整榜单",
    "切换到电视剧热播榜"
  ],
  "collection_target": {
    "entity": "电视剧榜单条目",
    "expected_total": 30,
    "fields": [
      "platform_name",
      "rank",
      "catalog_name",
      "catalog_type",
      "release_date",
      "tag",
      "collected_date"
    ],
    "output_format": "JSONL"
  },
  "requirements": [
    "rank 从 1 开始连续",
    "只采集完整榜单，不采集预览卡片",
    "失败时保留 partial output 和 summary",
    "结束时必须 force-stop App"
  ],
  "preferred_capabilities": {
    "cli": ["uixt", "android-adb"],
    "skills": ["skill-creator", "android-adb", "uixt"],
    "reuse_policy": "prefer_existing"
  },
  "eval": {
    "max_iterations": 10,
    "min_score": 0.92,
    "require_e2e": true
  }
}
```

### 6.3 附件和样例

可提供：

- UI 截图、流程截图包、录屏。
- Web 页面 HTML、HAR、DOM snapshot、页面截图。
- API 请求/响应样例、OpenAPI 文档、鉴权说明。
- Excel/CSV/JSONL/数据库样例和期望输出。
- 内部系统操作步骤、异常页面样例。
- 历史运行日志、失败产物和人工修正后的金标数据输出。

这些输入会转为：

- 操作链路资产：生成 `references/<target>.md`。
- 评测资产：生成 L1/L2/L3 eval cases。
- 失败归因资产：迭代失败时对比当前产物和金标数据。

## 7. Capability Reuse

用户可在需求中指定已有 CLI、skills 或内部工具。Hermes 在生成 skill、评测集和执行计划时必须优先复用。

复用策略：

- `prefer_existing`：优先使用用户指定能力；只有缺失、不可用或无法满足评测目标时，才生成新的辅助脚本。
- `required`：指定能力为强约束；若能力不可用，任务失败并反馈缺失依赖。
- `advisory`：指定能力仅作为建议，Hermes 可根据评测目标选择其它实现。

Skill Bootstrap 时必须把复用能力写入 `SKILL.md` 的执行前提和 workflow，例如：

- Android UI 操作优先使用 `uixt`。
- Android 设备状态、App 启停、截图、网络和输入控制优先使用 `android-adb`。
- 新 skill 创建结构必须遵循 `skill-creator`。
- 飞书文档/表格创建、读取、更新、附件和评论状态写回统一使用 `lark-cli`。

如果已有能力不能直接覆盖需求，Code Worker 可以在新 skill 的 `scripts/` 中编写薄封装，但不应重复实现底层通用能力。

## 8. Eval Suite

### 8.1 版本化冻结

评测集需要冻结，但冻结的是当前版本。

```text
一次自循环优化任务绑定一个固定 eval_suite_version
```

规则：

- 用户确认前：评测集可反复修改。
- 用户确认后：当前版本冻结，例如 `eval_suite_v1`。
- 自循环阶段：只改 skill/reference/scripts，不改 `eval_suite_v1`。
- 如果用户发现评测集有问题：创建 `eval_suite_v2`，重新 review/freeze 后启动新的优化任务。

冻结后必须记录：

- `eval_suite_version`
- `eval_suite_hash`
- `confirmed_by`
- `confirmed_at`
- 冻结快照链接

### 8.2 四层评测

| 层级 | 名称 | 输入 | 作用 |
|---|---|---|---|
| L0 | 结构规则评测 | JSONL、summary、log、输出文件 | 快速验证 schema、字段、rank、cleanup 等确定性规则 |
| L1 | 单步抽取/解析评测 | 截图、HTML、API response、文件样例、日志片段 | 验证单步抽取或解析是否正确 |
| L2 | 状态/流程评测 | 页面状态、流程节点、异常样例 | 验证是否进入正确状态以及下一步动作是否合理 |
| L3 | 真实环境端到端评测 | 真实 App/Web/API/文件/内部系统 | 最终门禁，验证完整采集链路 |

L3 示例：

- Web 站点端到端采集。
- API 拉取、分页、清洗和落库。
- 文件批处理和结果导出。
- 内部系统登录、查询、下载和汇总。
- Android App 启动、导航、采集、后处理和清理。

### 8.3 评分原则

推荐每个 eval suite 包含：

- 硬门禁：失败则本轮不通过。
- 加权软分：用于衡量趋势和选择最佳版本。
- 稳定性指标：耗时、重试次数、worker 失败率、模型调用次数。
- 产物完整性：JSONL、summary、日志、截图、diff、报告。

MVP 评分采用“硬门禁 + 加权软分”：

- 硬门禁失败时，本轮直接不通过，即使软分较高也不能进入成功态。
- 软分用于比较不同迭代版本，帮助选择最佳候选版本。
- 默认通过分 `min_score=0.92`。
- 视频榜单 MVP 的硬门禁至少包含 schema 正确、rank 连续、条数达标、清理动作完成和 L3 端到端通过。

## 9. Feishu Workspace Model

所有飞书侧操作统一通过 `lark-cli` 完成。Hermes 不直接拼飞书 OpenAPI 请求；统一调度 Feishu Worker，由它调用 `lark-cli` 完成飞书交互。

飞书权限按 `lark-cli` 的身份和 scope 体系管理。Feishu Worker 根据操作类型选择 bot 或 user 身份：机器人消息、常规表格写入优先使用 bot；需要读取用户上传附件、访问用户私有云文档或完成授权动作时，按 `lark-cli` 权限要求切换到 user 身份。所有身份切换都必须记录到任务审计日志。

### 9.1 核心表

**Eval Suites**

- `suite_id`
- `skill_name`
- `scenario`
- `target_systems`
- `status`
- `version`
- `eval_suite_hash`
- `created_by`
- `confirmed_by`
- `confirmed_at`

状态流转：

```text
generated -> user_reviewing -> revision_requested -> user_reviewing
generated/user_reviewing -> confirmed -> frozen
```

**Eval Cases**

- `case_id`
- `suite_id`
- `level`: `L0 | L1 | L2 | L3`
- `target_system`
- `case_name`
- `input`
- `expected`
- `hard_gates`
- `score_weight`
- `attachments`
- `user_feedback`
- `review_status`: `draft | approved | rejected | revised`
- `reviewed_by`
- `reviewed_at`

**Artifacts**

- `artifact_id`
- `task_id`
- `run_id`
- `case_id`
- `type`: `screenshot | gold_jsonl | summary | log | zip | diff | report`
- `file_link`
- `description`

**Iteration Runs**

- `run_id`
- `task_id`
- `suite_id`
- `iteration`
- `status`: `queued | running | passed | failed | stopped`
- `score`
- `passed`
- `hard_gate_result`
- `diagnosis`
- `failure_reason`
- `changed_files`
- `diff_link`
- `artifact_links`
- `next_action`
- `started_at`
- `ended_at`

**Iteration Comments**

- `comment_id`
- `run_id`
- `case_id`
- `comment_by`
- `comment_text`
- `comment_type`: `hint | correction | stop | retry | change_requirement`
- `status`: `pending | processing | processed | ignored | failed`
- `idempotency_key`
- `processed_by`
- `processing_started_at`
- `processed_at`
- `attempt_count`
- `agent_decision`: `accepted | rejected | needs_new_eval_suite`
- `decision_reason`
- `applied_in_iteration`

**Feedback Consumptions**

- `idempotency_key`
- `comment_id`
- `run_id`
- `consumer`
- `status`: `started | succeeded | failed`
- `result_hash`
- `created_at`
- `updated_at`

**Daily Runs**

- `daily_run_id`
- `skill_name`
- `skill_version`
- `target_system`
- `status`
- `scheduled_at`
- `started_at`
- `ended_at`
- `items_collected`
- `expected_total`
- `score`
- `hard_gate_result`
- `failure_reason`
- `artifact_links`
- `needs_optimization`
- `optimization_trigger_reason`
- `linked_optimization_request_id`

### 9.2 MVP 状态源

MVP 先使用飞书多维表格作为主要状态源；如需本地持久化，先用本地文件存储，暂不引入内部数据库。

使用飞书表格 + 本地文件时，需要补齐：

- 原子抢占的实现方式。
- worker lease 超时释放。
- 幂等 upsert。
- 任务锁。
- 多 watcher 并发处理。

本地文件建议保存：

- 当前任务状态快照。
- worker lease。
- 已消费评论的幂等记录缓存。
- 最近一次飞书同步游标。
- 自循环每轮的本地运行摘要。

后续生产形态仍建议升级为内部 DB 作为强一致状态源，飞书表格作为用户可见镜像。

## 10. Skill Bootstrap

评测集冻结后，Hermes 基于 `skill-creator` 创建标准化 skill。

生成的 skill 存放在 `EvalSkills` 仓库中。自循环通过后产出候选版本，最终发布到 skills 平台前由人工确认。

首版生成时建议使用 `v0.1.0.0` 作为初始版本。自循环只负责提交候选版本，不自动发布到正式 skills 平台；人工确认发布后，再由发布流程同步到正式目录或 registry。

目录结构：

```text
<skill-name>/
├── SKILL.md
├── dataclaw.json                    # Skill 元数据：版本号、suite_id、task_id、patch mode 等
├── references/
│   ├── <target-system>.md
│   └── output-contract.md
├── scripts/
│   ├── collect.ts
│   ├── eval_runner.ts
│   └── postprocess.ts
└── evals/
    └── evals.json
```

`SKILL.md` 必须包含：

- YAML frontmatter：`name`、强触发 `description`
- 适用场景
- 输入参数
- 执行前提
- 复用能力
- 目标系统选择逻辑
- 操作/采集步骤
- 抽取/解析策略
- 输出格式
- 本地校验
- 失败产物保留
- 清理步骤
- 已知陷阱

`evals/evals.json` 从冻结的飞书评测集生成，并记录：

```json
{
  "suite_id": "xxx",
  "suite_version": "v1",
  "suite_hash": "sha256:...",
  "skill_name": "generated-video-hotlist-crawler",
  "evals": []
}
```

### 10.1 版本号策略

生成 skill 的版本号采用自增小版本号后缀。

推荐格式：

```text
v<major>.<minor>.<patch>.<revision>
```

示例：

```text
v0.1.0.0  # 初版
v0.1.0.1  # 第 1 次自循环修改
v0.1.0.2  # 第 2 次自循环修改
```

规则：

- 每一次修改 `SKILL.md`、`references/`、`scripts/` 或其它 skill 内容，都必须自增 `revision`。
- 仅运行评测但没有产生文件修改，不自增版本号。
- 每轮 `Iteration Runs` 必须记录修改前版本和修改后版本。
- 发布到 skills 平台前，由人工确认最终候选版本。

## 11. Self-Loop Iteration

每轮迭代流程：

```text
1. Run L0
2. Run L1
3. Run L2
4. L0-L2 通过后 Run L3
5. Judge 打分
6. Diagnose 失败归因
7. Patch skill/script
8. 记录 diff 和产物
9. 写入飞书 Iteration Runs
10. 读取并处理用户评论
11. 通知飞书进度
12. 判断是否继续
```

允许修改：

- `SKILL.md`
- `references/*.md`
- `scripts/*.ts|py|sh`
- skill 内部辅助文件

自循环修改策略：

- Agent 可自行应用 patch，无需每轮等待用户批准。
- 每次产生文件修改后，自增 skill 小版本号后缀。
- 每轮必须记录 diff、修改原因、修改前版本和修改后版本。
- 最终发布到 skills 平台前必须人工确认。

禁止修改：

- 冻结后的飞书评测集。
- `evals/evals.json` 中的 suite 内容。
- 金标截图和金标结果。
- 用户确认的成功标准。

失败归因分类：

- `navigation_error`
- `popup_blocked`
- `wrong_tab`
- `preview_list_collected`
- `extraction_error`
- `rank_gap`
- `field_parse_error`
- `swipe_strategy_error`
- `app_crash_or_background`
- `postprocess_error`
- `environment_error`

每轮输出：

```json
{
  "iteration": 4,
  "score": 0.88,
  "passed": false,
  "hard_gates": {
    "schema": true,
    "rank_continuity": true,
    "expected_total": false,
    "cleanup": true
  },
  "failure_reason": "collected 24/30, likely stopped on preview list",
  "changed_files": [
    "SKILL.md",
    "references/tencent.md",
    "scripts/collect.ts"
  ],
  "next_action": "improve navigation into full rank page"
}
```

## 12. Feedback Consumption Semantics

Hermes 采用“事件监听 + 表格轮询”的混合机制：

- 飞书机器人消息、卡片按钮、确认、暂停、终止等控制类交互走事件监听，要求秒级响应。
- `Iteration Comments` 表中的策略反馈走轮询，默认每 30-60 秒读取一次，也会在每轮开始前和结束后立即读取。
- 长时间 L3 任务执行中，低频轮询 `stop/retry` 类控制反馈；普通策略反馈不打断当前执行，留到下一轮生效。

评论消费流程：

```text
1. Comment Watcher 查询 status = pending 的评论
2. 生成或读取 idempotency_key
3. 在 Feedback Consumptions 中 upsert idempotency_key
   -> 已 succeeded：跳过
   -> 已 started 且未超时：跳过
   -> failed 或 started 超时：允许重试
4. 尝试抢占评论：
   status = processing
   processed_by = <worker_id>
   processing_started_at = now
   attempt_count = attempt_count + 1
5. 重新读取评论，确认 processed_by 是自己
6. 执行反馈分类和策略处理
7. 成功后写回：
   Iteration Comments.status = processed
   Feedback Consumptions.status = succeeded
   agent_decision / decision_reason / applied_in_iteration
8. 失败后写回 failed；达到重试上限后等待人工处理
```

状态机：

```text
pending -> processing -> processed
pending -> processing -> failed
failed -> pending            # 人工或系统重试
processing -> pending        # lease 超时后释放
```

幂等键策略：

- MVP 默认 `idempotency_key = comment_id + updated_at + run_id`。
- 如果用户编辑评论，`updated_at` 变化，视为新版本反馈重新消费。
- 如果产品希望“只消费第一次”，可改为 `idempotency_key = comment_id`，用户需要新增评论才能触发新反馈。

## 13. Worker Execution Architecture

Hermes Agent 定位为产品编排控制面，运行在 DataClaw Hermes App / Tool 内。需要 agent 执行业务流程时，加载 `dataclaw-skill-builder` 总控 skill，再调度具体 worker。

执行角色：

- `Skill Creator Worker`：基于 `skill-creator` 创建标准 skill 目录、`SKILL.md`、reference、scripts 和 evals。
- `Code Worker`：修改 skill 内容、reference 和采集/后处理脚本。
- `Eval Runner Worker`：运行 L0/L1/L2/L3 评测，输出评分和报告。
- `Environment Worker`：按场景控制目标环境，例如 Android 设备、浏览器、API 客户端、文件系统、数据库或内部系统。
- `Device Worker`：`Environment Worker` 的一种实现，控制 Android 设备，执行 App 启动、导航、截图、滑动和清理。
- `Judge Worker`：聚合评测结果，做硬门禁判断、打分和失败归因。
- `Feishu Worker`：通过 `lark-cli` 写表格、读反馈、上传附件、发送机器人消息。

执行引擎通过统一 `Agent Execution Adapter` 接入：

```text
Hermes Agent
  -> Agent Execution Adapter
     -> ClaudeCode
     -> OpenCode
     -> DeepAgents
     -> 本地 CLI / 专用 Worker
```

MVP 默认执行器：

- 首版默认使用 ClaudeCode 执行代码修改、skill 生成和自循环 patch。
- OpenCode、DeepAgents 和专用 Worker 作为后续扩展。
- 即使默认使用 ClaudeCode，也必须通过 `Agent Execution Adapter` 调度，避免架构绑定单一执行器。
- MVP 先不设置模型调用预算、设备占用预算、token 预算或 wall time 预算等硬约束；仅保留运行记录，为后续成本治理提供数据。

核心原则：

- Hermes 不绑定任何单一执行引擎。
- 所有 worker 都通过统一任务协议接收输入、返回状态和产物。
- 每次 worker 执行生成 `worker_run_id`，并关联到 `Iteration Runs`。
- 所有飞书交互必须经过 Feishu Worker + `lark-cli`，避免执行器绕过统一审计。

**轻量直连模式下的执行架构**

在轻量直连模式下，`dataclaw_gateway.ts` 替代 Hermes Agent 作为控制面，通过 `claude -p` 直接 spawn Claude Code 进程。Claude Code 同时承担 Carrier（读取 SKILL.md 编排 scripts 调用）和 Worker（应用 patch、修改文件、执行命令）双重角色。会话通过 `--resume` 实现上下文延续。详见 `references/feishu-gateway.md`。

## 14. Completion Rules

成功条件：

- 所有硬门禁通过。
- 总分达到 `min_score`，默认 `0.92`。
- L3 真实环境端到端评测通过。
- 产物完整：skill、评测报告、JSONL/结果文件、summary、日志、截图/样例。

失败条件：

- 达到最大迭代次数，默认 `10`。
- 连续多轮同类失败无改善。
- 目标环境长期不可用。
- 用户目标不可判定或与评测集矛盾。
- 需要新增评测集信息，但当前 suite 已冻结。

失败时返回：

- 最佳轮次。
- 最佳分数。
- 已通过项。
- 未通过项。
- 失败原因。
- 关键截图/日志/样例。
- 建议用户补充的信息或人工介入点。

## 15. Feishu Notifications

机器人至少发送四类消息：

**需求确认**

- 目标系统。
- 操作链路。
- 采集字段。
- 成功标准。
- 指定复用能力。
- 最大迭代次数。

**评测集 Review**

```text
评测集已生成，请在表格中确认每条 case。
确认后我会冻结评测集，并开始创建 skill。
```

**迭代进度**

- 当前轮次。
- 当前分数。
- 硬门禁结果。
- 失败归因。
- 修改摘要。
- 产物链接。

**最终通知**

成功：

```text
采集 skill 已生成并通过评测。
Skill: <link/path>
Eval report: <link>
Artifacts: <link>
```

失败：

```text
已达到最大优化次数，未完全达标。
最佳轮次: N
最佳分数: X
主要问题: ...
建议: ...
```

## 16. MVP Scope

整体产品是通用自动采集 skill 开发与持续调优平台。MVP 只做视频榜单采集，因为它同时覆盖 UI 导航、截图抽取、长列表滑动、失败归因和日常运行观测等关键能力。

MVP 支持：

- DataClaw Hermes App 作为常驻产品载体。
- `dataclaw-skill-builder` 作为总控 skill。
- 飞书 `/dataclaw create/status/latest/artifacts/pause/resume/stop/retry/operate` 主入口。
- 飞书机器人接收结构化 Markdown + 图片/zip。
- 需求中声明应复用的 CLI/skills，并在 skill 创建和执行计划中体现。
- 自动生成评测集。
- 写入飞书多维表格。
- 用户反馈后调整评测集。
- 用户确认后冻结。
- 基于 `skill-creator` 生成标准 skill。
- 执行 L0/L1/L2/L3 混合评测。
- 最多 10 轮自循环优化。
- 飞书消息通知最终结果。
- 自循环每轮写入飞书表格，支持用户实时查看和评论。
- Hermes 通过 adapter 调度 ClaudeCode/OpenCode/DeepAgents 或专用 Worker。
- 飞书消息主动查询状态、产物、失败原因，并支持暂停/继续/终止/重跑。
- 日常运行记录写入 `Daily Runs`，支持后续触发持续优化。
- 所有飞书表格/文档/附件/消息交互统一通过 `lark-cli`。
- 状态源先使用飞书多维表格；必要时使用本地文件存储辅助状态。
- 自循环可自行修改代码，最终发布前人工确认。
- 默认执行器使用 ClaudeCode。
- 生成 skill 存放在 `EvalSkills` 仓库。
- skill 每次修改都自增小版本号后缀。

暂不做：

- 多用户并发大规模调度。
- 自动发布到生产 skill registry。
- 大范围覆盖所有采集场景；MVP 只做视频榜单，后续再扩展 Web/API/文件/内部系统。
- 跨平台 iOS/HarmonyOS。
- 完全无金标数据的内容准确率评估。
- 复杂权限审批流。
- 资源预算限制和成本治理。
- 内部数据库强一致状态源。

## 17. Test Plan

- **需求解析测试**：输入单目标系统、多目标系统、缺少访问方式、缺少字段的需求，验证 Hermes 能生成待补充结构。
- **命令入口测试**：验证 `/dataclaw create/status/pause/resume/stop/retry/operate` 可正确路由到内部任务协议。
- **总控 skill 测试**：验证 DataClaw Hermes App 能加载 `dataclaw-skill-builder` 并按其流程生成评测集、创建 skill、执行自循环。
- **通用场景抽象测试**：分别用 Android App、Web 页面、API response、文件样例作为输入，验证能生成统一的 skill spec 和 eval suite。
- **Markdown 模板解析测试**：输入结构化 Markdown，验证能稳定解析为内部 `SkillCreationRequest`。
- **能力复用解析测试**：输入 `指定复用能力`，验证 Hermes 在 skill spec、执行前提和 worker plan 中优先使用指定 CLI/skills。
- **lark-cli 交互测试**：验证创建表格、写记录、读反馈、上传附件、发送通知均通过 `lark-cli` 路径完成。
- **附件处理测试**：上传单图、多图、zip、文件样例，验证能生成流程步骤和 L1/L2 case。
- **飞书表格测试**：验证表格创建、附件写入、用户反馈读取、状态流转、冻结 hash。
- **评测冻结测试**：冻结后尝试修改 eval case，应被拒绝并要求创建新版本。
- **评测版本测试**：验证 `eval_suite_v1` 冻结后，新目标变更会创建 `eval_suite_v2`。
- **Skill 创建测试**：检查生成 skill 是否符合 `skill-creator` 标准目录和 frontmatter。
- **skill 存储测试**：验证生成 skill 写入 `EvalSkills` 仓库，且不污染无关目录。
- **版本自增测试**：验证每次文件修改后小版本号后缀自增，纯评测不修改版本号。
- **迭代测试**：构造一个会失败的初版 skill，验证系统能诊断、patch、重跑。
- **迭代记录测试**：验证每轮执行记录、diff、产物和失败归因都写入飞书表格。
- **评论反馈测试**：验证用户评论可被读取、分类、采纳或拒绝，并记录 agent 决策。
- **评论幂等测试**：验证同一条评论在多次轮询、worker 重启和 API 重试下只成功消费一次。
- **评论重试测试**：验证 `processing` 超时可释放回 `pending`，超过重试上限后进入 `failed`。
- **状态查询测试**：验证用户通过飞书消息查询当前进度、最近失败、产物链接和 worker 状态。
- **日常运行测试**：验证定时运行记录进入 `Daily Runs`，异常触发优化任务。
- **日常异常确认测试**：验证异常时先推送问题汇总和优化建议，用户确认后才启动自循环优化。
- **执行器调度测试**：验证 Hermes 可通过 adapter 调度不同 worker，并把 worker 产物关联到同一轮迭代。
- **默认执行器测试**：验证首版默认通过 ClaudeCode 执行代码修改和自循环 patch。
- **最大轮次测试**：设置 `max_iterations=2`，确认失败总结完整。
- **成功闭环测试**：用小榜单或 mock 环境验证从输入到最终通知全链路。

## 18. Assumptions and Deferred Scope

本节只保留方案落地时的外部依赖和暂缓项，已确定的产品决策已写入前文对应章节。

- Hermes Agent 已具备飞书机器人入口、长任务编排、worker 调度和消息回调能力；若现有 Hermes 能力不足，需要先补齐 DataClaw Hermes App / Tool。
- `lark-cli` 已完成飞书应用配置、授权和必要 scope 申请，且能覆盖文档、表格、多维表格、附件和消息操作。
- 视频榜单 MVP 可获得可用 Android 设备、目标 App、网络环境和必要账号状态。
- 用户能提供足够的场景链路、截图或样例，使系统能生成可执行评测集；完全没有金标数据或样例时，只能生成较弱的结构性评测。
- 自循环阶段允许用户评论影响优化策略，但用户提出新的采集目标、字段或 金标数据修改时，需要创建新的 eval suite version。
- 大规模多用户并发、跨组织权限、复杂审批流、资源预算治理和内部 DB 强一致状态源不在 MVP 范围内。

## 19. Implementation Progress

> 最后更新：2026-04-25
> 代码位置：`EvalSkills/dataclaw-skill-builder/`

### 19.1 当前状态和已实现

当前已经具备完整的 DataClaw Skill 业务逻辑层：可从结构化 Markdown 需求生成评测集、创建标准 skill、执行本地 self-loop、生成 ClaudeCode patch request、记录迭代、生成飞书写入命令、消费反馈、执行日常运行异常检测。Carrier 层（Hermes Agent / OpenClaw / nanobot）负责网关常驻、事件路由、任务队列和定时调度，不在 skill 内实现。

> 注：`hermes_app.ts` 曾在 skill 内实现了 Carrier 的部分职责（命令路由、事件处理、评论轮询），但在 f34cef7 中被移除。原因：Carrier 层职责不应由 skill 承担，违反 §3.1 定义的双层边界。SKILL.md 中的 Carrier Integration Guide 取代了 hermes_app.ts，以文档形式描述 Carrier 应如何调用 skill scripts。

#### 核心管道（Build Mode 主流程）

| 模块 | 脚本 | 说明 |
|------|------|------|
| 需求解析 | `scripts/parse_request.ts` | Markdown → SkillCreationRequest |
| 飞书文档导入 | `scripts/feishu_import.ts` | 飞书文档 URL → lark-cli 读取命令 + workspace 设置 + 管道命令 |
| 评测集生成 | `scripts/generate_eval_suite.ts` | L0-L3 + hard gates + score_weight |
| 编排入口 | `scripts/build_workflow.ts` | parse → generate eval → review manifest → optional freeze/bootstrap |
| Skill 创建 | `scripts/bootstrap_skill.ts` | 标准目录 + SKILL.md + references + scripts + `evals/evals.json` + `dataclaw.json` |
| 自循环迭代 | `scripts/self_loop.ts` | mvp-mock + claude-code 双 patch mode；--resume-iteration 恢复；collector 120s 超时；迭代记录 version_after/changed_files 更新 |
| Judge 打分 | `scripts/judge_iteration.ts` | 硬门禁 + 加权软分 |
| 版本自增 | `scripts/bump_version.ts` | v\<major>.\<minor>.\<patch>.\<revision> 格式 |
| 迭代记录 | `scripts/record_iteration.ts` | 写入 iterations/ 目录 |

#### Patch 模式（§13）

| 功能 | 脚本 |
|------|------|
| mvp-mock 自动 patch | `scripts/patch_worker.ts` — 用确定性 mock collector 替换 skeleton |
| claude-code patch artifact 生成 | `scripts/patch_worker.ts` — 写 patch-requests/ 供 agent 读取 |
| patch-apply 记录变更 | `scripts/patch_apply.ts` — 版本自增 + 写迭代记录 |
| --resume-iteration 恢复循环 | `scripts/self_loop.ts` — 含前置迭代记录校验 |

#### Carrier 对接指引（§3.1、§5）

Skill 不实现网关、队列、调度或事件路由。Carrier 根据 SKILL.md 的「Carrier Integration Guide」调用 scripts。典型对接场景：

| Carrier 场景 | 调用的脚本 | 说明 |
|------|------|------|
| 用户提交采集需求 | `npm run self-loop -- --input <request.md> ...` | Carrier 从飞书消息提取 request 内容 |
| 从飞书文档创建 | `npm run feishu-import -- --url <url> ...` | 生成 lark-cli 读取命令，Carrier 执行后走标准管道 |
| 查询任务状态 | 读取 `<workspace>/task-state.json` | 关键状态值见 SKILL.md |
| 暂停/继续/停止 | 更新 `task-state.json` 的 `status` | 自循环下一轮读取决定是否继续 |
| 恢复 Patch | `npm run patch-apply` + `npm run self-loop --resume-iteration` | Agent 完成 patch 后 Carrier 调用 |
| 定时日常运行 | `npm run daily-run` | Carrier 调度器触发；检测到异常时执行输出中的 `feishu_commands` |
| 评论轮询 | `npm run feishu-poll` → 执行 lark-cli → `npm run consume-feedback` | Carrier 定期执行 |
| 编排入口（可选） | `npm run build-workflow` | parse → generate eval → review manifest → optional freeze/bootstrap |

#### 飞书 Bitable 集成（§9）

| 功能 | 脚本 |
|------|------|
| 7 表 schema + 建表命令 | `scripts/feishu_prepare.ts` — mode: create-tables |
| 写入评测集/用例/迭代记录/日常运行/产物 | `scripts/feishu_prepare.ts` — write modes；单条记录支持 `record_id/feishu_record_id` 时更新，否则按 create 输出并提示需保存 record_id |
| 轮询评论/review/反馈消费状态 | `scripts/feishu_poll.ts` — 3 个 poll mode |
| 所有命令 @payloadFile 防注入 | 全部脚本 — 不再内联 JSON 到 shell 字符串 |

#### 反馈消费（§12）

| 功能 | 脚本 |
|------|------|
| 评论分类 + agent 决策 | `scripts/consume_feedback.ts` — correction→apply_patch、strategy→apply_patch、approval→skip、rejection→escalate、pause→escalate、stop→escalate、resume→skip |
| 幂等消费 + 本地缓存 | `scripts/consume_feedback.ts` — idempotency-cache.json |
| 飞书写回命令生成 | `scripts/consume_feedback.ts` — 使用 `record_id` 更新原评论行；缺失 record_id 时不消费、不创建重复评论行，并输出 escalated + warning |

#### Operate Mode（§4.2）

| 功能 | 脚本 |
|------|------|
| 日常运行 collector + judge | `scripts/daily_run.ts` |
| 异常检测 | `scripts/daily_run.ts` — 连续失败（≥3，包含当前 run）、条数低于阈值（<80%）、重复原因（≥3） |
| 飞书写入 + 通知命令生成 | `scripts/daily_run.ts` — @payloadFile 模式 |

#### 文档与类型

| 内容 | 状态 |
|------|------|
| SKILL.md | ✅ Architecture Boundary + Carrier Integration Guide + ClaudeCode patch + Operate Mode |
| references/ | ✅ design-spec, eval-suite-design, feishu-tables, feedback-consumption, worker-protocol, build-operate-modes |
| dataclaw_common.ts | ✅ 完整类型定义（Feishu/Feedback/DailyRun/TaskState）+ 工具函数 |
| package.json | ✅ 15 个 npm scripts（parse-request、generate-eval-suite、bootstrap-skill、judge-iteration、build-workflow、bump-version、record-iteration、self-loop、patch-apply、feishu-prepare、feishu-poll、consume-feedback、daily-run、feishu-import、check） |
| evals/ | ✅ 5 条端到端评测 + 2 个 fixture |
| .dataclaw/hermes/ | 占位目录（空），Carrier 层不在此实现 |

### 19.2 已验证命令

```bash
cd /Users/debugtalk/MyProjects/ByteDance/EvalSkills/dataclaw-skill-builder

# Feishu document import
npm run feishu-import -- --url "https://bytedance.feishu.cn/docx/DoxydKLHHo0UfDxskVwcYbJwnRd" --workspace /tmp/dataclaw-feishu/tasks --output-root /tmp/dataclaw-feishu/generated

# Build workflow（编排入口）
npm run build-workflow -- --input evals/fixtures/tencent-video-hotlist-request.md --workspace /tmp/dataclaw-review/tasks --output-root /tmp/dataclaw-review/generated

# Self-loop — mvp-mock 模式
npm run self-loop -- --input evals/fixtures/tencent-video-hotlist-request.md --workspace /tmp/dataclaw-review-selfloop/tasks --output-root /tmp/dataclaw-review-selfloop/generated --max-iterations 3

# Self-loop — claude-code 模式
npm run self-loop -- --input evals/fixtures/tencent-video-hotlist-request.md --workspace /tmp/dataclaw-review-claude/tasks --output-root /tmp/dataclaw-review-claude/generated --max-iterations 3 --patch-mode claude-code

# Feedback 消费
npm run consume-feedback -- --comments <comments.json> --workspace <workspace> --base-token <base> --comments-table-id <table> --feedback-table-id <table>

# Feishu 写入
npm run feishu-prepare -- --mode write-iteration-run --base-token <base> --table-id <table> --iteration-record <record.json>

# Daily run
npm run daily-run -- --skill-dir <skill> --eval-suite <eval-suite.json> --workspace <workspace> --past-records <past.json>

# Patch apply + resume（claude-code 模式）
npm run patch-apply -- --skill-dir <path> --iteration 1 --changed-files "scripts/collect.ts,SKILL.md" --diagnosis "navigation error" --patch-description "fixed scroll strategy" --failure-reason "rank gap" --workspace <workspace>
npm run self-loop -- --workspace <workspace> --resume-iteration 2 --patch-mode claude-code
```

验证结果：

- `mvp-mock` self-loop：第 1 轮失败，第 1 轮 patch 后版本从 `v0.1.0.0` 到 `v0.1.0.1`，第 2 轮通过。
- `claude-code` self-loop：失败后进入 `awaiting_patch`，生成 `patch-requests/iteration-*-claude-code.md`，不伪造代码修改，不自增版本。
- feedback 消费：有 `record_id` 时更新原评论行；无 `record_id` 时 escalated，不写本地成功缓存、不创建重复评论行。
- Feishu write modes：有 `record_id/feishu_record_id` 时生成 update 命令；无 record_id 时按 create 输出，并标记 `requires_record_id_for_idempotent_retry=true`。
- Daily Run：连续失败阈值包含当前 run，第三次失败即可触发异常建议。
- build-workflow：parse → generate eval → review manifest 流程完整；加 `--confirmed` 可继续 freeze/bootstrap。

### 19.3 待完成 TODO

> 以下 P0-P6 为实现优先级排序（Priority），非项目阶段（Milestone）。项目阶段统一使用 M 系列标签，见 [`docs/roadmap.md`](../../docs/roadmap.md)。

#### P0 — Carrier 层接入（§3.1、§5）

Skill 层业务逻辑已完成。Carrier 层（Hermes Agent / OpenClaw / nanobot）负责网关常驻、事件路由、任务队列和调度。

> hermes_app.ts 已移除（f34cef7），Carrier 层职责回归到真正的常驻框架实现。SKILL.md 的 Carrier Integration Guide 是当前唯一对接规范。

| # | 事项 | 方案章节 | 说明 |
|---|------|---------|------|
| 1 | Carrier 网关常驻 + `/dataclaw` 命令路由 | §5.1 | Carrier 解析飞书消息意图，调用对应 skill scripts |
| 2 | 任务队列 + 状态持久化 | §3.1 | Carrier 管理任务生命周期（queued/running/awaiting_patch/passed/failed/paused/stopped） |
| 3 | 定时 Daily Run 调度 | §4.2 | Carrier 调度器触发 `npm run daily-run`，处理异常通知 |
| 4 | 飞书消息卡片模板 | §15 | 当前脚本生成 text send 命令和 payload；Carrier 后续升级为交互卡片 |
| 5 | Feishu Bitable 作为主状态源的双写/回读 | §9.2 | 当前 task-state 使用本地文件；后续补 Feishu row id 映射和回读同步 |
| 6 | 评论轮询消费闭环调度 | §12 | 当前可生成 poll 命令；Carrier 编排 lark-cli 执行 → consume_feedback → patch/retry |

#### P1 — 反馈消费完整闭环（§12）

| # | 事项 | 说明 |
|---|------|------|
| 8 | 原子抢占（pending → processing） | consume_feedback 已支持 record_id 更新，但抢占 + 二次确认仍需 Hermes/Feishu Worker 执行 |
| 9 | Worker lease 超时释放 | processing 超时后回退到 pending |
| 10 | 重试上限 + 人工处理 | attempt_count 达上限后标记 failed 等待人工 |
| 11 | 用户编辑评论后重新消费 | idempotency_key 含 updated_at，脚本层支持；需要 Feishu poll 保留 updated_at 和 record_id |

#### P2 — 评测集 Review 闭环（§8.1、§9.1）

| # | 事项 | 说明 |
|---|------|------|
| 12 | 评测集写入飞书 → 用户 review → 确认/退回 | 状态流转 generated → user_reviewing → confirmed → frozen |
| 13 | 评测集版本切换 | 用户发现评测集有问题时创建 v2 |
| 14 | 冻结验证 | 冻结后修改 eval case 应被拒绝 |

#### P3 — 日常运行闭环（§4.2）

| # | 事项 | 说明 |
|---|------|------|
| 15 | 定时 Daily Run 调度器 | cron/scheduler 驱动 daily_run.ts |
| 16 | 异常确认 → 自动创建优化任务 | 当前只生成建议，确认后进入 Build Mode 的流程未实现 |
| 17 | 健康检查分数下降检测 | §4.2 触发条件之一 |

#### P4 — Worker 执行架构（§13）

| # | 事项 | 说明 |
|---|------|------|
| 18 | Agent Execution Adapter 抽象层 | 当前有 patch mode 抽象和 ClaudeCode artifact；真正调用 ClaudeCode/OpenCode/DeepAgents 的常驻 adapter 未实现 |
| 19 | Environment Worker / Device Worker | uixt + android-adb 设备控制，依赖 Hermes App 调度 |
| 20 | Worker 并发控制 + 失败恢复 | MVP 不设硬约束但需记录 |
| 21 | Worker run_id 关联 | 每次 worker 执行需生成 run_id 并关联到 Iteration Runs |

#### P5 — Skill 生成增强（§10）

| # | 事项 | 说明 |
|---|------|------|
| 22 | 附件处理（截图/zip/HAR → references + eval cases） | §6.3 |
| 23 | 失败归因分类 | §11 定义 11 类（navigation_error 等），当前 failure_reason 是自由文本 |
| 24 | 最佳轮次回退 | §14 失败时返回最佳轮次/最佳分数/已通过项 |
| 25 | 真实采集脚本生成 | 当前可生成 skeleton 和 MVP mock collector；真实目标系统采集逻辑仍需 ClaudeCode/worker 实现 |

#### P6 — 测试（§17）

| # | 事项 | 说明 |
|---|------|------|
| 26 | 单元测试 + 集成测试 | 当前有手工 smoke 命令；仍缺自动化测试套件 |
| 27 | Fixture 覆盖 | 只有 tencent-video-hotlist-request.md 一个 fixture |

### 19.4 推进建议

1. **P0 Carrier 接入**：选择一个 Carrier 框架（Hermes Agent / OpenClaw / nanobot），按 SKILL.md 的 Carrier Integration Guide 配置路由和调度，把飞书消息 → skill scripts 串起来
2. **P1-P3 闭环**：评测集 review、反馈抢占、日常运行调度已有脚本，但还需要真实 Feishu row 回读和 Carrier 编排
3. **P4-P6 质量**：Worker 抽象、附件处理、测试覆盖在闭环验证后逐步补齐
