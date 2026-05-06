# LetsGoal 终态报告

- 任务 ID: `request-phase1-20260505163544-61c813`
- 目标: 实现 M4 阶段 1：入口（Skill 触发 + 飞书文档需求流）。

具体包括：
1. **类型扩展**：在 `core/scripts/types.ts` 中新增 `awaiting_review` 任务状态、`ReviewOutput` 接口、`FeishuDocRef` 接口，扩展 `LoopConfig` 增加飞书和通知字段
2. **飞书文档操作**：新建 `core/scripts/feishu.ts`，封装 `createDoc(title, markdown)` 和 `appendDoc(docId, markdown)` 两个函数，内部调用 `lark-cli` 命令行工具
3. **需求 Review**：新建 `core/scripts/review.ts`，实现 `reviewRequirement(rawInput)` 将用户自然语言需求结构化、`generateReviewMarkdown(review)` 生成飞书文档内容、`applyReviewFeedback(review, feedback)` 处理用户反馈
4. **请求解析扩展**：修改 `core/scripts/parse_request.ts`，解析 LoopConfig 中新增的飞书/通知字段，支持 `## 原始需求` section
5. **自循环主流程集成**：修改 `core/scripts/self_loop.ts`，在 plan 之前插入 review 阶段（含飞书文档创建），resume 时处理 `awaiting_review` 状态
6. **模板更新**：修改 `directions/development/templates/request.md`，新增 `## 原始需求` section

### 类型定义细节

```typescript
// TaskStatus 新增
| "awaiting_review"  // 需求已结构化，等待用户确认

// ReviewOutput 接口
interface ReviewOutput {
  raw_requirement: string;           // 用户原始输入
  clarified_goal: string;            // 澄清后的目标
  suggested_constraints: string[];   // 建议的约束
  suggested_stories: { id: string; title: string }[];  // 建议的 stories
  questions: string[];               // 需要用户确认的问题
  confidence: number;                // 0-1，需求清晰度置信度
}

// FeishuDocRef 接口
interface FeishuDocRef {
  doc_url: string;   // 飞书文档 URL
  doc_id: string;    // 飞书文档 ID
}

// LoopConfig 扩展
interface LoopConfig {
  // ... 现有字段 ...
  feishu_doc_url?: string;           // 飞书文档 URL（review 后填充）
  feishu_doc_id?: string;            // 飞书文档 ID（review 后填充）
  feishu_chat_id?: string;           // 飞书群聊 ID（通知用）
  notify_channel?: "terminal" | "feishu" | "both";  // 通知通道，默认 terminal
}
```

### feishu.ts 设计

```typescript
// 创建飞书文档，返回 FeishuDocRef
export async function createDoc(title: string, markdown: string): Promise<FeishuDocRef>
  // 调用: lark-cli docs +create --title "..." --markdown "..."
  // 解析输出获取 doc_id 和 doc_url

// 追加内容到飞书文档
export async function appendDoc(docId: string, markdown: string): Promise<void>
  // 调用: lark-cli docs +update --doc <id> --mode append --markdown "..."

// 检查 lark-cli 是否可用
export function isLarkCliAvailable(): boolean
  // 检查 which lark-cli 是否成功

// 错误处理：lark-cli 不存在时给出明确错误提示和安装引导
```

### review.ts 设计

```typescript
// 将用户自然语言需求结构化
export async function reviewRequirement(rawInput: string): Promise<ReviewOutput>
  // 调用 claude -p 将用户输入结构化为 ReviewOutput

// 生成飞书文档 Markdown 内容
export function generateReviewMarkdown(review: ReviewOutput): string
  // 按 request.md 格式生成结构化内容

// 处理用户反馈
export function applyReviewFeedback(review: ReviewOutput, feedback: string): ReviewOutput
  // 基于用户反馈修改 ReviewOutput
```

### self_loop.ts 修改要点

在 plan 之前插入 review 阶段：
1. 解析 request.md 后，检查是否有 `## 原始需求` section 或 goal 是否为非结构化描述
2. 调用 `reviewRequirement()` 结构化需求
3. 调用 `createDoc()` 创建飞书文档
4. 设置 `task.status = "awaiting_review"`
5. 在终端输出飞书文档链接和结构化摘要
6. 等待用户确认（resume 时从 awaiting_review 恢复）
7. 确认后进入正常的 plan → execute 循环

resume 时处理 `awaiting_review`：
- 从 task-state.json 读取状态
- 如果 status === "awaiting_review"，提示用户确认
- 用户确认后进入 plan 阶段

### 重要约束

- 所有新文件必须包含完整的 TypeScript 类型定义
- 新增类型字段使用 snake_case 命名
- feishu.ts 中 lark-cli 调用使用 spawnSync，超时 30 秒
- review.ts 中调用 claude 使用 `claude -p` 格式，与 executor.ts 保持一致
- 不修改 `core/references/loop-protocol.md`
- 不删除任何已有功能或测试
- 新增代码必须有对应的 vitest 测试
- 方向: development
- 终态: **passed**
- 总轮次: 1 / 5
- 最佳分数: 1 (轮次 1)
- 创建时间: 2026-05-05T16:35:44.686Z
- 更新时间: 2026-05-05T16:44:33.135Z

## 每轮结果
| 轮次 | 状态 | 硬门禁 | commit | changed_files / 归因 |
|---|---|---|---|---|
| 1 | passed | typecheck=✓ test=✓ | `86d0561` | .letsgoal-m26/request-phase1.md, core/scripts/__tests__/autonomy.test.ts, core/scripts/__tests__/feishu.test.ts, core/scripts/__tests__/parse_request.test.ts, core/scripts/__tests__/review.test.ts, core/scripts/autonomy.ts, core/scripts/feishu.ts, core/scripts/parse_request.ts, core/scripts/review.ts, core/scripts/self_loop.ts, core/scripts/types.ts, directions/development/DIRECTION.md, directions/development/templates/request.md, docs/design.md, docs/roadmap.md |
