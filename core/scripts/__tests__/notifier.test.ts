import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shouldNotify,
  sendNotification,
  formatTerminalNotification,
  extractNotificationConfig,
} from "../notifier.js";
import type { NotificationConfig, NotificationPayload } from "../notifier.js";
import { spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("../feishu.js", () => ({
  isLarkCliAvailable: vi.fn(() => true),
  sendFeishuMessage: vi.fn(),
  _resetLarkCliCache: vi.fn(),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

const defaultConfig: NotificationConfig = {
  enabled: true,
  channel: "terminal",
  consecutive_failure_threshold: 3,
};

const basePayload: NotificationPayload = {
  event: "escalation",
  task_id: "test-001",
  iteration: 2,
  message: "归因升级",
  detail: "test failure",
};

// ============================================================================
// shouldNotify
// ============================================================================

describe("shouldNotify", () => {
  it("escalation 始终通知", () => {
    expect(shouldNotify("escalation", defaultConfig)).toBe(true);
  });

  it("awaiting_human 始终通知", () => {
    expect(shouldNotify("awaiting_human", defaultConfig)).toBe(true);
  });

  it("task_completed 始终通知", () => {
    expect(shouldNotify("task_completed", defaultConfig)).toBe(true);
  });

  it("consecutive_failures 在未达阈值时不通知", () => {
    expect(shouldNotify("consecutive_failures", defaultConfig, 2)).toBe(false);
  });

  it("consecutive_failures 在达到阈值时通知", () => {
    expect(shouldNotify("consecutive_failures", defaultConfig, 3)).toBe(true);
  });

  it("consecutive_failures 超过阈值时通知", () => {
    expect(shouldNotify("consecutive_failures", defaultConfig, 5)).toBe(true);
  });

  it("enabled=false 时不通知", () => {
    expect(shouldNotify("escalation", { ...defaultConfig, enabled: false })).toBe(false);
  });
});

// ============================================================================
// formatTerminalNotification
// ============================================================================

describe("formatTerminalNotification", () => {
  it("包含事件类型、task_id、iteration、message", () => {
    const result = formatTerminalNotification(basePayload);
    expect(result).toContain("ESCALATION");
    expect(result).toContain("test-001");
    expect(result).toContain("iteration: 2");
    expect(result).toContain("归因升级");
    expect(result).toContain("detail: test failure");
  });

  it("无 iteration 时不显示 iteration 行", () => {
    const payload: NotificationPayload = {
      event: "task_completed",
      task_id: "test-002",
      message: "任务完成",
    };
    const result = formatTerminalNotification(payload);
    expect(result).not.toContain("iteration:");
  });

  it("无 detail 时不显示 detail 行", () => {
    const payload: NotificationPayload = {
      event: "task_completed",
      task_id: "test-003",
      message: "任务完成",
    };
    const result = formatTerminalNotification(payload);
    expect(result).not.toContain("detail:");
  });

  it("每种事件类型都有操作建议", () => {
    const events: Array<NotificationPayload["event"]> = [
      "escalation",
      "awaiting_human",
      "consecutive_failures",
      "task_completed",
    ];
    for (const event of events) {
      const payload: NotificationPayload = { event, task_id: "t", message: "m" };
      const result = formatTerminalNotification(payload);
      expect(result).toContain("→");
    }
  });
});

// ============================================================================
// sendNotification
// ============================================================================

describe("sendNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("terminal 通道写入 stdout", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await sendNotification(basePayload, { ...defaultConfig, channel: "terminal" });
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("feishu 通道但无 chat_id 时不发送飞书", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await sendNotification(basePayload, { ...defaultConfig, channel: "feishu" });
    // 没有抛错，也没有调用 spawnSync
    expect(mockedSpawnSync).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("both 通道时同时输出终端和飞书", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
    } as ReturnType<typeof spawnSync>);

    await sendNotification(basePayload, {
      ...defaultConfig,
      channel: "both",
      feishu_chat_id: "chat-123",
    });
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("飞书通知失败不抛错", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { isLarkCliAvailable } = await import("../feishu.js");
    (isLarkCliAvailable as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "fail",
      error: undefined,
    } as ReturnType<typeof spawnSync>);

    // should not throw
    await sendNotification(basePayload, {
      ...defaultConfig,
      channel: "both",
      feishu_chat_id: "chat-123",
    });
    errSpy.mockRestore();
  });
});

// ============================================================================
// 飞书通道通过 sendNotification 间接测试
// ============================================================================

describe("feishu channel via sendNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("飞书通知失败不抛错（sendFeishuMessage 内部 catch）", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { sendFeishuMessage } = await import("../feishu.js");
    (sendFeishuMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("lark-cli 发送消息失败");
    });

    await sendNotification(basePayload, {
      ...defaultConfig,
      channel: "both",
      feishu_chat_id: "chat-123",
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ============================================================================
// extractNotificationConfig
// ============================================================================

describe("extractNotificationConfig", () => {
  it("默认 terminal 通道", () => {
    const config = extractNotificationConfig({
      max_iterations: 10,
      min_score: 0.92,
    });
    expect(config.channel).toBe("terminal");
    expect(config.enabled).toBe(true);
    expect(config.consecutive_failure_threshold).toBe(3);
  });

  it("feishu 通道但无 chat_id 时降级到 terminal", () => {
    const config = extractNotificationConfig({
      max_iterations: 10,
      min_score: 0.92,
      notify_channel: "feishu",
    });
    expect(config.channel).toBe("terminal");
  });

  it("both 通道有 chat_id 时保留", () => {
    const config = extractNotificationConfig({
      max_iterations: 10,
      min_score: 0.92,
      notify_channel: "both",
      feishu_chat_id: "chat-abc",
    });
    expect(config.channel).toBe("both");
    expect(config.feishu_chat_id).toBe("chat-abc");
  });

  it("feishu 通道有 chat_id 时保留", () => {
    const config = extractNotificationConfig({
      max_iterations: 10,
      min_score: 0.92,
      notify_channel: "feishu",
      feishu_chat_id: "chat-xyz",
    });
    expect(config.channel).toBe("feishu");
    expect(config.feishu_chat_id).toBe("chat-xyz");
  });
});
