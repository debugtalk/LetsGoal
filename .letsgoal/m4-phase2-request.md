# 开发调试任务

## 目标

实现 M4 阶段 2：可观测性（决策通知 + 迭代过程记录到飞书文档）。

具体包括：
1. **决策通知**：新建 `core/scripts/notifier.ts`，实现通知事件定义、`shouldNotify()` 判断逻辑、`sendNotification()` 发送函数，支持终端和飞书双通道
2. **autonomy.ts 扩展**：新增 `shouldNotifyOnDecision()` 和 `getNotificationConfig()` 辅助函数
3. **self_loop.ts 集成**：在诊断后、升级时、循环结束时调用通知；每轮迭代结束后将关键进展追加到飞书文档

### notifier.ts 设计

```typescript
// 通知事件类型
type NotificationEvent =
  | "escalation"          // 归因升级（始终通知）
  | "awaiting_human"      // 等待人工决策（始终通知）
  | "consecutive_failures" // 同一 category 连续 3 次失败
  | "task_completed";     // 任务完成

// 通知配置
interface NotificationConfig {
  enabled: boolean;
  channel: "terminal" | "feishu" | "both";
  feishu_chat_id?: string;
  consecutive_failure_threshold: number; // 默认 3
}

// 通知负载
interface NotificationPayload {
  event: NotificationEvent;
  task_id: string;
  iteration?: number;
  message: string;
  detail?: string;
}

// 判断是否应该发送通知
export function shouldNotify(
  event: NotificationEvent,
  config: NotificationConfig,
  consecutiveCount?: number,
): boolean

// 发送通知（终端 + 可选飞书消息）
export async function sendNotification(
  payload: NotificationPayload,
  config: NotificationConfig,
): Promise<void>

// 格式化终端通知
export function formatTerminalNotification(payload: NotificationPayload): string

// 发送飞书消息通知
export async function sendFeishuNotification(
  payload: NotificationPayload,
  chatId: string,
): Promise<void>
  // 调用: lark-cli im +messages-send --chat-id <id> --markdown "..." --as bot

// 从 LoopConfig 提取通知配置
export function extractNotificationConfig(config: LoopConfig): NotificationConfig
```

### autonomy.ts 扩展

```typescript
// 判断当前决策是否需要通知
export function shouldNotifyOnDecision(
  autonomyMode: AutonomyMode,
  event: NotificationEvent,
): boolean

// 获取通知配置（从 LoopConfig 提取）
export function getNotificationConfig(task: LoopTask): NotificationConfig
```

### self_loop.ts 修改要点

1. **通知集成**：
   - 诊断后：如果归因为升级分类（escalation），发送 `escalation` 通知
   - 暂停时：发送 `awaiting_human` 通知
   - 循环结束时：发送 `task_completed` 通知
   - 连续同类失败检测：跟踪当前连续失败 category 计数，达到阈值时发送 `consecutive_failures` 通知

2. **迭代过程记录到飞书文档**：
   - 每轮迭代结束后，如果有飞书文档 ID，调用 `appendDoc()` 追加迭代摘要
   - 迭代摘要格式：

   ```markdown
   ## 迭代 N — <timestamp>

   **状态**：通过/失败
   **硬门禁**：lint ✅ typecheck ✅ test ❌
   **软分**：<加权分>
   **诊断**：<category> — <reason>
   **关键结论**：<1-2 句总结>

   ---
   ```

3. **连续失败跟踪**：
   - 在主循环中维护 `consecutiveFailureCategory` 和 `consecutiveFailureCount`
   - 每轮失败时，如果 category 与上一轮相同，计数 +1；不同则重置
   - 达到阈值（默认 3）时发送 `consecutive_failures` 通知

### 重要约束

- 通知功能不得影响主循环的正常运行（通知失败不应导致循环中断）
- 终端通知为默认通道，零配置即可使用
- 飞书消息通知仅在配置了 feishu_chat_id 且 lark-cli 可用时生效
- 迭代记录追加失败不应影响循环继续
- 所有新增代码必须有 vitest 测试
- 现有 161 个测试全部通过后才能提交

## 项目根目录

/Users/debugtalk/MyProjects/MyGitHub/notes/projects/LetsGoal

## 约束

- 使用 TypeScript
- 不引入新的运行时依赖
- 保持现有 API 兼容（所有已有测试必须继续通过）
- 通知失败不应阻塞主循环
- 追加飞书文档失败不应阻塞主循环
- 终端通知格式简洁，包含操作建议
- 飞书消息使用 Markdown 格式

## 禁止改动

- core/references/loop-protocol.md
- directions/development/DIRECTION.md
- docs/roadmap.md
- docs/design.md

## 配置

```yaml
task_type: feature
language: typescript
success_criteria:
  hard_gates:
    - typecheck
    - test
loop_config:
  max_iterations: 5
  min_score: 1.0
  autonomy_mode: standard
commands:
  typecheck: npx tsc --noEmit
  test: npx vitest run
```
