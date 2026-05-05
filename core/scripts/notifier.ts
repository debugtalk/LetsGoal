/**
 * 通知模块
 *
 * 提供决策通知能力，支持终端和飞书双通道。
 * 通知失败不影响主循环运行。
 */

import { spawnSync } from "node:child_process";
import type { LoopConfig } from "./types.js";
import { isLarkCliAvailable } from "./feishu.js";

// ============================================================================
// 类型定义
// ============================================================================

export type NotificationEvent =
  | "escalation"
  | "awaiting_human"
  | "consecutive_failures"
  | "task_completed";

export interface NotificationConfig {
  enabled: boolean;
  channel: "terminal" | "feishu" | "both";
  feishu_chat_id?: string;
  consecutive_failure_threshold: number;
}

export interface NotificationPayload {
  event: NotificationEvent;
  task_id: string;
  iteration?: number;
  message: string;
  detail?: string;
}

// ============================================================================
// 判断是否发送通知
// ============================================================================

export function shouldNotify(
  event: NotificationEvent,
  config: NotificationConfig,
  consecutiveCount?: number,
): boolean {
  if (!config.enabled) return false;

  // escalation 和 awaiting_human 始终通知
  if (event === "escalation" || event === "awaiting_human" || event === "task_completed") {
    return true;
  }

  // consecutive_failures 达到阈值时通知
  if (event === "consecutive_failures") {
    return (consecutiveCount ?? 0) >= config.consecutive_failure_threshold;
  }

  return false;
}

// ============================================================================
// 发送通知
// ============================================================================

export async function sendNotification(
  payload: NotificationPayload,
  config: NotificationConfig,
): Promise<void> {
  // 终端通知
  if (config.channel === "terminal" || config.channel === "both") {
    const text = formatTerminalNotification(payload);
    process.stdout.write(text + "\n");
  }

  // 飞书通知
  if (config.channel === "feishu" || config.channel === "both") {
    if (config.feishu_chat_id) {
      try {
        await sendFeishuNotification(payload, config.feishu_chat_id);
      } catch (e) {
        process.stderr.write(
          `[notifier] 飞书通知发送失败: ${(e as Error).message}\n`,
        );
      }
    }
  }
}

// ============================================================================
// 终端通知格式化
// ============================================================================

export function formatTerminalNotification(payload: NotificationPayload): string {
  const icon: Record<NotificationEvent, string> = {
    escalation: "⚠️",
    awaiting_human: "⏸",
    consecutive_failures: "🔄",
    task_completed: "✅",
  };

  const lines: string[] = [];
  lines.push(`[${icon[payload.event]} ${payload.event.toUpperCase()}] task=${payload.task_id}`);
  if (payload.iteration !== undefined) {
    lines.push(`  iteration: ${payload.iteration}`);
  }
  lines.push(`  ${payload.message}`);
  if (payload.detail) {
    lines.push(`  detail: ${payload.detail}`);
  }

  // 操作建议
  const hints: Record<NotificationEvent, string> = {
    escalation: "→ 建议: 检查归因分类，决定是否人工介入",
    awaiting_human: "→ 建议: 使用 --resume 继续任务",
    consecutive_failures: "→ 建议: 检查同类失败根因，考虑调整策略",
    task_completed: "→ 查看 .letsgoal/final-report.md 了解详情",
  };
  lines.push(hints[payload.event]);

  return lines.join("\n");
}

// ============================================================================
// 飞书消息通知
// ============================================================================

export async function sendFeishuNotification(
  payload: NotificationPayload,
  chatId: string,
): Promise<void> {
  if (!isLarkCliAvailable()) {
    process.stderr.write("[notifier] lark-cli 不可用，跳过飞书通知\n");
    return;
  }

  const md = buildFeishuMarkdown(payload);

  const r = spawnSync(
    "lark-cli",
    ["im", "+messages-send", "--chat-id", chatId, "--markdown", md, "--as", "bot"],
    { encoding: "utf-8", timeout: 15_000 },
  );

  if (r.error || r.status !== 0) {
    throw new Error(
      `lark-cli 发送消息失败: ${r.error?.message ?? `exit ${r.status}`}`,
    );
  }
}

function buildFeishuMarkdown(payload: NotificationPayload): string {
  const eventLabel: Record<NotificationEvent, string> = {
    escalation: "⚠️ 归因升级",
    awaiting_human: "⏸ 等待人工决策",
    consecutive_failures: "🔄 连续同类失败",
    task_completed: "✅ 任务完成",
  };

  let md = `**${eventLabel[payload.event]}**\n`;
  md += `Task: \`${payload.task_id}\`\n`;
  if (payload.iteration !== undefined) {
    md += `Iteration: ${payload.iteration}\n`;
  }
  md += `${payload.message}\n`;
  if (payload.detail) {
    md += `> ${payload.detail}\n`;
  }
  return md;
}

// ============================================================================
// 从 LoopConfig 提取通知配置
// ============================================================================

export function extractNotificationConfig(config: LoopConfig): NotificationConfig {
  const channel = config.notify_channel ?? "terminal";
  const hasFeishuChat = Boolean(config.feishu_chat_id);

  return {
    enabled: true,
    channel: hasFeishuChat && (channel === "feishu" || channel === "both")
      ? channel
      : channel === "feishu" && !hasFeishuChat
        ? "terminal"
        : channel,
    feishu_chat_id: config.feishu_chat_id,
    consecutive_failure_threshold: 3,
  };
}
