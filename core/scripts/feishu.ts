/**
 * 飞书文档操作模块
 *
 * 封装 lark-cli 命令行工具,提供创建和追加飞书文档、发送飞书消息的能力。
 * lark-cli 不可用时给出明确错误提示和安装引导。
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { FeishuDocRef } from "./types.js";

const LARK_CLI = "lark-cli";
const CLI_TIMEOUT_MS = 30_000;

// ============================================================================
// lark-cli 可用性（模块级缓存）
// ============================================================================

let _larkCliAvailable: boolean | undefined;

/**
 * 检查 lark-cli 是否可用。结果在进程生命周期内缓存。
 */
export function isLarkCliAvailable(): boolean {
  if (_larkCliAvailable !== undefined) return _larkCliAvailable;
  const r = spawnSync("which", [LARK_CLI], {
    encoding: "utf-8",
    timeout: 5_000,
  });
  _larkCliAvailable = r.status === 0;
  return _larkCliAvailable;
}

/** 仅供测试：重置缓存 */
export function _resetLarkCliCache(): void {
  _larkCliAvailable = undefined;
}

// ============================================================================
// lark-cli 通用调用
// ============================================================================

function runLarkCli(args: string[], errorContext: string): SpawnSyncReturns<string> {
  if (!isLarkCliAvailable()) {
    throw new Error(
      `lark-cli 未安装。请先安装: npm install -g lark-cli 或参考 https://github.com/larksuite/lark-cli`,
    );
  }

  const r = spawnSync(LARK_CLI, args, {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT_MS,
  });

  if (r.error) {
    throw new Error(`lark-cli 执行失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `lark-cli ${errorContext}(exit ${r.status}): ${(r.stderr ?? "").trim()}`,
    );
  }

  return r;
}

// ============================================================================
// 文档操作
// ============================================================================

/**
 * 创建飞书文档,返回文档引用。
 */
export function createDoc(
  title: string,
  markdown: string,
): FeishuDocRef {
  const r = runLarkCli(
    ["docs", "+create", "--title", title, "--markdown", markdown],
    "创建文档失败",
  );
  return parseDocRef((r.stdout ?? "").trim());
}

/**
 * 追加内容到飞书文档。
 */
export function appendDoc(
  docId: string,
  markdown: string,
): void {
  runLarkCli(
    ["docs", "+update", "--doc", docId, "--mode", "append", "--markdown", markdown],
    "追加文档失败",
  );
}

/**
 * 发送飞书消息。
 */
export function sendFeishuMessage(
  chatId: string,
  markdown: string,
): void {
  runLarkCli(
    ["im", "+messages-send", "--chat-id", chatId, "--markdown", markdown, "--as", "bot"],
    "发送消息失败",
  );
}

// ============================================================================
// 输出解析
// ============================================================================

function parseDocRef(stdout: string): FeishuDocRef {
  try {
    const obj = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof obj.doc_id === "string" && typeof obj.doc_url === "string") {
      return { doc_id: obj.doc_id, doc_url: obj.doc_url };
    }
  } catch {
    // 非 JSON,继续尝试其他格式
  }

  const idMatch = /doc_id[:\s]+(\S+)/.exec(stdout);
  const urlMatch = /doc_url[:\s]+(\S+)/.exec(stdout);

  if (idMatch && urlMatch) {
    return { doc_id: idMatch[1], doc_url: urlMatch[1] };
  }

  throw new Error(
    `无法从 lark-cli 输出中解析文档引用。原始输出:\n${stdout}`,
  );
}
