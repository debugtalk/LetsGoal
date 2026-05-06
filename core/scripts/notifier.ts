/**
 * 通知模块
 *
 * 提供决策通知能力，支持终端和飞书双通道。
 * 通知失败不影响主循环运行。
 */

import type { LoopConfig } from "./types.js";
import { isLarkCliAvailable, sendFeishuMessage } from "./feishu.js";

// ============================================================================
// 类型定义
// ============================================================================

export type NotificationEvent =
  | "escalation"
  | "awaiting_human"
  | "consecutive_failures"
  | "task_completed";

export type NotifyChannel = "terminal" | "feishu" | "both";

export interface NotificationConfig {
  enabled: boolean;
  channel: NotifyChannel;
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

  if (event === "escalation" || event === "awaiting_human" || event === "task_completed") {
    return true;
  }

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
  if (config.channel === "terminal" || config.channel === "both") {
    process.stdout.write(formatTerminalNotification(payload) + "\n");
  }

  if (config.channel === "feishu" || config.channel === "both") {
    if (config.feishu_chat_id) {
      try {
        const md = buildFeishuMarkdown(payload);
        sendFeishuMessage(config.feishu_chat_id, md);
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
// 飞书消息格式化
// ============================================================================

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
  let channel: NotifyChannel = config.notify_channel ?? "terminal";
  const hasFeishuChat = Boolean(config.feishu_chat_id);
  const canFeishu = hasFeishuChat && isLarkCliAvailable();

  // 飞书不可用时降级到终端
  if (!canFeishu && (channel === "feishu" || channel === "both")) {
    channel = "terminal";
  }

  return {
    enabled: true,
    channel,
    feishu_chat_id: config.feishu_chat_id,
    consecutive_failure_threshold: 3,
  };
}
